use crate::surface::Mesh;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArapReport {
    pub iterations: usize,
    pub energy_before: f64,
    pub energy_after: f64,
    pub converged: bool,
    pub reverted: bool,
}
struct Element {
    indices: [usize; 3],
    gx: [f64; 3],
    gy: [f64; 3],
    area: f64,
}
struct BoundarySpring {
    a: usize,
    b: usize,
    length: f64,
    weight: f64,
}
fn spring_energy(springs: &[BoundarySpring], uv: &[[f64; 2]]) -> f64 {
    springs
        .iter()
        .map(|s| {
            let length = (uv[s.a][0] - uv[s.b][0]).hypot(uv[s.a][1] - uv[s.b][1]);
            s.weight * (length - s.length).powi(2)
        })
        .sum()
}
/// Linearize scalar lengths, not edge vectors: sewing constraints must leave
/// boundary tangents free to turn while fixing the physical edge lengths.
fn refine_seamed(
    elements: &[Element],
    springs: &[BoundarySpring],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchor: usize,
    limit: usize,
) -> Result<ArapReport, &'static str> {
    use std::collections::BTreeMap;
    let free: Vec<_> = (0..uv.len()).filter(|&i| i != anchor).collect();
    let mut index = vec![None; uv.len()];
    for (i, &v) in free.iter().enumerate() {
        index[v] = Some(2 * i);
    }
    let n = free.len() * 2;
    let mut base = vec![BTreeMap::<usize, f64>::new(); n];
    for e in elements {
        for axis in 0..2 {
            for gradient in [e.gx, e.gy] {
                for k in 0..3 {
                    if let Some(i) = index[e.indices[k]] {
                        for j in 0..3 {
                            if let Some(l) = index[e.indices[j]] {
                                *base[i + axis].entry(l + axis).or_default() +=
                                    e.area * gradient[k] * gradient[j];
                            }
                        }
                    }
                }
            }
        }
    }
    let area: f64 = elements.iter().map(|e| e.area).sum();
    let objective = |p: &[[f64; 2]]| energy(elements, p) + spring_energy(springs, p) / area;
    let before = objective(uv);
    let mut after = before;
    let mut iterations = 0;
    let mut converged = false;
    for iteration in 0..limit {
        let mut matrix = base.clone();
        let mut rhs = vec![0.; n];
        for e in elements {
            let r = rotation(e, uv);
            for axis in 0..2 {
                for (column, gradient) in [e.gx, e.gy].into_iter().enumerate() {
                    let residual = r[axis * 2 + column]
                        - (0..3)
                            .map(|k| gradient[k] * uv[e.indices[k]][axis])
                            .sum::<f64>();
                    for k in 0..3 {
                        if let Some(i) = index[e.indices[k]] {
                            rhs[i + axis] += e.area * gradient[k] * residual;
                        }
                    }
                }
            }
        }
        for s in springs {
            let delta = [uv[s.b][0] - uv[s.a][0], uv[s.b][1] - uv[s.a][1]];
            let length = delta[0].hypot(delta[1]);
            if length <= 0. {
                return Err("NUMERICAL_FAILURE");
            }
            let mut row = Vec::with_capacity(4);
            for (v, sign) in [(s.a, -1.), (s.b, 1.)] {
                if let Some(i) = index[v] {
                    for (axis, value) in delta.iter().enumerate() {
                        row.push((i + axis, sign * value / length));
                    }
                }
            }
            for &(i, a) in &row {
                rhs[i] += s.weight * a * (s.length - length);
                for &(j, b) in &row {
                    *matrix[i].entry(j).or_default() += s.weight * a * b;
                }
            }
        }
        let matrix: Vec<Vec<_>> = matrix
            .into_iter()
            .map(|r| r.into_iter().collect())
            .collect();
        let Some(factor) = crate::sparse::Factor::new(&matrix) else {
            return Err("ARAP_NOT_CONVERGED");
        };
        let delta = factor.solve(&rhs);
        if delta.iter().any(|v| !v.is_finite()) {
            return Err("NUMERICAL_FAILURE");
        }
        let mut step = 1.;
        let mut accepted = None;
        for _ in 0..32 {
            let mut trial = uv.clone();
            for (i, &v) in free.iter().enumerate() {
                trial[v][0] += step * delta[2 * i];
                trial[v][1] += step * delta[2 * i + 1];
            }
            if positive(faces, &trial) {
                let value = objective(&trial);
                if value <= after + 1e-12 {
                    accepted = Some((trial, value));
                    break;
                }
            }
            step *= 0.5;
        }
        let Some((trial, value)) = accepted else {
            break;
        };
        iterations = iteration + 1;
        converged = (after - value).abs() < 1e-10 * after.max(1.)
            && springs.iter().all(|s| {
                let length = (trial[s.a][0] - trial[s.b][0]).hypot(trial[s.a][1] - trial[s.b][1]);
                (length / s.length - 1.).abs() < 1e-5
            });
        *uv = trial;
        after = value;
        if converged {
            break;
        }
    }
    Ok(ArapReport {
        iterations,
        energy_before: before,
        energy_after: after,
        converged,
        reverted: false,
    })
}
fn inner(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn rotation(e: &Element, uv: &[[f64; 2]]) -> [f64; 4] {
    let mut j = [0.; 4];
    for k in 0..3 {
        let p = uv[e.indices[k]];
        j[0] += p[0] * e.gx[k];
        j[1] += p[0] * e.gy[k];
        j[2] += p[1] * e.gx[k];
        j[3] += p[1] * e.gy[k];
    }
    let a = (j[2] - j[1]).atan2(j[0] + j[3]);
    [a.cos(), -a.sin(), a.sin(), a.cos()]
}
fn energy(elements: &[Element], uv: &[[f64; 2]]) -> f64 {
    let mut total = 0.;
    let mut area = 0.;
    for e in elements {
        let r = rotation(e, uv);
        let mut j = [0.; 4];
        for k in 0..3 {
            let p = uv[e.indices[k]];
            j[0] += p[0] * e.gx[k];
            j[1] += p[0] * e.gy[k];
            j[2] += p[1] * e.gx[k];
            j[3] += p[1] * e.gy[k];
        }
        total += e.area * j.iter().zip(r).map(|(a, b)| (a - b).powi(2)).sum::<f64>();
        area += e.area;
    }
    total / area
}
fn positive(faces: &[[usize; 3]], uv: &[[f64; 2]]) -> bool {
    faces.iter().all(|f| {
        let [a, b, c] = f.map(|i| uv[i]);
        crate::numerical::positive_area2([a, b, c]).is_some()
    })
}

/// Triangle ARAP parameterization: closest SO(2) rotations, FEM global least squares,
/// one translation anchor, and energy-decreasing line search preserving triangle orientation.
pub fn refine(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchors: [usize; 2],
    limit: usize,
) -> Result<ArapReport, &'static str> {
    refine_with_weights(mesh, globals, faces, uv, anchors, limit, None)
}

/// Minimax-oriented retries for the hard manufacturing limits. Area-weighted
/// ARAP can ignore tiny boundary triangles created by material intersections.
/// Promote measured failures relative to the median element area, without
/// removing those triangles or relaxing their physical acceptance limits.
pub fn refine_balanced(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchors: [usize; 2],
    limit: usize,
) -> Result<ArapReport, &'static str> {
    let areas: Vec<_> = faces
        .iter()
        .map(|f| {
            let p = f.map(|i| &mesh.vertices[globals[i]]);
            let u = [
                p[1].x_mm - p[0].x_mm,
                p[1].y_mm - p[0].y_mm,
                p[1].z_mm - p[0].z_mm,
            ];
            let v = [
                p[2].x_mm - p[0].x_mm,
                p[2].y_mm - p[0].y_mm,
                p[2].z_mm - p[0].z_mm,
            ];
            (u[1] * v[2] - u[2] * v[1])
                .hypot(u[2] * v[0] - u[0] * v[2])
                .hypot(u[0] * v[1] - u[1] * v[0])
                / 2.
        })
        .collect();
    let mut sorted = areas.clone();
    sorted.sort_by(f64::total_cmp);
    let reference = sorted[sorted.len() / 2];
    let mut weights = vec![1_f64; faces.len()];
    let mut current = uv.clone();
    let mut best = quality_ratios(mesh, globals, faces, uv)
        .into_iter()
        .fold(0_f64, f64::max);
    let mut best_report = None;
    for _ in 0..6.min(limit) {
        let ratios = quality_ratios(mesh, globals, faces, &current);
        for (i, ratio) in ratios.iter().enumerate() {
            if *ratio > 1. {
                let correction = ratio.powi(4).max(1.5);
                weights[i] = (weights[i] * correction).max(reference / areas[i]).min(1e6);
            }
        }
        let report = refine_with_weights(
            mesh,
            globals,
            faces,
            &mut current,
            anchors,
            limit,
            Some(&weights),
        )?;
        let quality = quality_ratios(mesh, globals, faces, &current)
            .into_iter()
            .fold(0_f64, f64::max);
        if quality < best {
            best = quality;
            *uv = current.clone();
            best_report = Some(report);
        }
        if quality <= 1. {
            break;
        }
    }
    best_report.ok_or("ARAP_NOT_CONVERGED")
}

/// Ratios to the existing maximum area, edge and combined distortion limits.
/// Physical triangle areas are measured by cross products, never by subtraction.
pub fn quality_ratios(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &[[f64; 2]],
) -> Vec<f64> {
    faces
        .iter()
        .map(|f| {
            let xyz = f.map(|i| &mesh.vertices[globals[i]]);
            let p = f.map(|i| uv[i]);
            let e1 = [
                xyz[1].x_mm - xyz[0].x_mm,
                xyz[1].y_mm - xyz[0].y_mm,
                xyz[1].z_mm - xyz[0].z_mm,
            ];
            let e2 = [
                xyz[2].x_mm - xyz[0].x_mm,
                xyz[2].y_mm - xyz[0].y_mm,
                xyz[2].z_mm - xyz[0].z_mm,
            ];
            let cross = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let area = inner(&cross, &cross).sqrt() / 2.;
            let projected = ((p[1][0] - p[0][0]) * (p[2][1] - p[0][1])
                - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]))
                / 2.;
            if crate::numerical::positive_area2(p).is_none()
                || crate::numerical::area3(xyz.map(|v| [v.x_mm, v.y_mm, v.z_mm])).is_none()
            {
                return f64::INFINITY;
            }
            let ea = (projected / area - 1.).abs();
            let l3: [f64; 3] = std::array::from_fn(|i| {
                let a = xyz[i];
                let b = xyz[(i + 1) % 3];
                (b.x_mm - a.x_mm)
                    .hypot(b.y_mm - a.y_mm)
                    .hypot(b.z_mm - a.z_mm)
            });
            let l2: [f64; 3] = std::array::from_fn(|i| {
                (p[(i + 1) % 3][0] - p[i][0]).hypot(p[(i + 1) % 3][1] - p[i][1])
            });
            let ee = (0..3)
                .map(|i| (l2[i] / l3[i] - 1.).abs())
                .fold(0., f64::max);
            let angle = |a: f64, b: f64, c: f64| {
                ((a * a + b * b - c * c) / (2. * a * b))
                    .clamp(-1., 1.)
                    .acos()
            };
            let et = (0..3)
                .map(|i| {
                    (angle(l3[i], l3[(i + 1) % 3], l3[(i + 2) % 3])
                        - angle(l2[i], l2[(i + 1) % 3], l2[(i + 2) % 3]))
                    .abs()
                        / std::f64::consts::PI
                })
                .fold(0., f64::max);
            (ea / 0.15)
                .max(ee / 0.10)
                .max((0.4 * ea + 0.4 * ee + 0.2 * et) / 0.15)
        })
        .collect()
}

fn refine_with_weights(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchors: [usize; 2],
    limit: usize,
    weights: Option<&[f64]>,
) -> Result<ArapReport, &'static str> {
    if faces.iter().any(|f| {
        crate::numerical::area3(f.map(|i| {
            let v = &mesh.vertices[globals[i]];
            [v.x_mm, v.y_mm, v.z_mm]
        }))
        .is_none()
    }) {
        return Err("NUMERICAL_FAILURE");
    }
    // Unit patch coordinates make CG residuals independent of physical size.
    // Rest lengths, UVs and energy use the same scale; reports remain dimensionless.
    let scale = faces
        .iter()
        .flat_map(|f| (0..3).map(move |i| (f[i], f[(i + 1) % 3])))
        .map(|(a, b)| {
            let a = &mesh.vertices[globals[a]];
            let b = &mesh.vertices[globals[b]];
            (a.x_mm - b.x_mm)
                .hypot(a.y_mm - b.y_mm)
                .hypot(a.z_mm - b.z_mm)
        })
        .fold(0., f64::max);
    if !scale.is_finite() || scale <= 0. {
        return Err("NUMERICAL_FAILURE");
    }
    let origin = &mesh.vertices[globals[anchors[0]]];
    let uv_origin = uv[anchors[0]];
    let conditioned = Mesh {
        repair_cuts: mesh.repair_cuts,
        initial_uv: None,
        method: mesh.method.clone(),
        iterations: mesh.iterations,
        vertices: mesh
            .vertices
            .iter()
            .map(|v| crate::surface::Vertex {
                id: v.id.clone(),
                x_mm: (v.x_mm - origin.x_mm) / scale,
                y_mm: (v.y_mm - origin.y_mm) / scale,
                z_mm: (v.z_mm - origin.z_mm) / scale,
            })
            .collect(),
        faces: mesh.faces.clone(),
    };
    let mut local: Vec<_> = uv
        .iter()
        .map(|p| [(p[0] - uv_origin[0]) / scale, (p[1] - uv_origin[1]) / scale])
        .collect();
    let report = refine_conditioned(
        &conditioned,
        globals,
        faces,
        &mut local,
        anchors,
        limit,
        weights,
    )?;
    if report.iterations > 0 {
        *uv = local
            .iter()
            .map(|p| [p[0] * scale + uv_origin[0], p[1] * scale + uv_origin[1]])
            .collect();
    }
    Ok(report)
}
fn refine_conditioned(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchors: [usize; 2],
    limit: usize,
    weights: Option<&[f64]>,
) -> Result<ArapReport, &'static str> {
    let mut elements = vec![];
    for (face_index, &indices) in faces.iter().enumerate() {
        let [a, b, c] = indices.map(|i| &mesh.vertices[globals[i]]);
        let e1 = [b.x_mm - a.x_mm, b.y_mm - a.y_mm, b.z_mm - a.z_mm];
        let e2 = [c.x_mm - a.x_mm, c.y_mm - a.y_mm, c.z_mm - a.z_mm];
        let l = inner(&e1, &e1).sqrt();
        let x = inner(&e1, &e2) / l;
        // Computing |e2|² - projection² erases a skinny triangle's altitude
        // through cancellation. Use the same stable cross-product area as LSCM.
        let cross = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];
        let h = inner(&cross, &cross).sqrt() / l;
        if crate::numerical::area3([a, b, c].map(|v| [v.x_mm, v.y_mm, v.z_mm])).is_none() {
            return Err("NUMERICAL_FAILURE");
        }
        elements.push(Element {
            indices,
            gx: [-1. / l, 1. / l, 0.],
            gy: [(x - l) / (l * h), -x / (l * h), 1. / h],
            area: l * h / 2. * weights.map_or(1., |w| w[face_index]),
        });
    }
    if !positive(faces, uv) {
        return Err("UNWRAP_FLIPPED");
    }
    // Sewing boundaries are physical lengths shared by neighbouring panels.
    // Penalize relative edge strain, including short material-intersection
    // edges; an area-only objective can otherwise ignore those edges entirely.
    let mut springs = Vec::new();
    if mesh.method == "arap-seamed" {
        let mut edges = std::collections::BTreeMap::<(usize, usize), usize>::new();
        for face in faces {
            for i in 0..3 {
                let (a, b) = (face[i], face[(i + 1) % 3]);
                *edges.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }
        // Boundary stiffness describes the physical panel. Increasing a
        // failed triangle's minimax weight must not simultaneously increase
        // every boundary spring and cancel that corrective weighting.
        let total_area: f64 = elements
            .iter()
            .enumerate()
            .map(|(i, e)| e.area / weights.map_or(1., |w| w[i]))
            .sum();
        let count = edges.values().filter(|&&count| count == 1).count().max(1);
        for ((a, b), count_edge) in edges {
            if count_edge != 1 {
                continue;
            }
            let p = &mesh.vertices[globals[a]];
            let q = &mesh.vertices[globals[b]];
            let length = (p.x_mm - q.x_mm)
                .hypot(p.y_mm - q.y_mm)
                .hypot(p.z_mm - q.z_mm);
            if length <= 0. {
                return Err("NUMERICAL_FAILURE");
            }
            springs.push(BoundarySpring {
                a,
                b,
                length,
                weight: 100_000. * total_area / count as f64 / length.powi(2),
            });
        }
    }
    if !springs.is_empty() {
        return refine_seamed(&elements, &springs, faces, uv, anchors[0], limit);
    }
    let objective = |points: &[[f64; 2]]| energy(&elements, points);
    let before = objective(uv);
    let mut after = before;
    let mut converged = before < 1e-12;
    let mut iterations = 0;
    // Each global step fixes local rotations; only its translation is null.
    // Pinning both initial endpoints also locks their arbitrary LSCM distance,
    // preventing an otherwise free material panel from reaching its rest size.
    let free: Vec<_> = (0..uv.len()).filter(|&i| i != anchors[0]).collect();
    let mut index = vec![None; uv.len()];
    for (i, &v) in free.iter().enumerate() {
        index[v] = Some(i);
    }
    let n = free.len();
    let mut rows = vec![];
    let mut diagonal = vec![0.; n];
    for e in &elements {
        for gradient in [e.gx, e.gy] {
            let row: Vec<_> = e
                .indices
                .iter()
                .zip(gradient)
                .map(|(&v, c)| (v, c * e.area.sqrt()))
                .collect();
            for &(v, c) in &row {
                if let Some(i) = index[v] {
                    diagonal[i] += c * c;
                }
            }
            rows.push(row);
        }
    }
    if diagonal.iter().any(|&d| d < 1e-14) {
        return Err("NUMERICAL_FAILURE");
    }
    // The FEM stiffness matrix is constant throughout the local/global
    // iterations. Assemble it once: expanding every triangle gradient on
    // every CG step repeats the same work thousands of times on a body chart.
    let mut stiffness = vec![std::collections::BTreeMap::<usize, f64>::new(); n];
    for row in &rows {
        for &(a, ca) in row {
            if let Some(i) = index[a] {
                for &(b, cb) in row {
                    if let Some(j) = index[b] {
                        *stiffness[i].entry(j).or_default() += ca * cb;
                    }
                }
            }
        }
    }
    let stiffness: Vec<Vec<(usize, f64)>> = stiffness
        .into_iter()
        .map(|row| row.into_iter().collect())
        .collect();
    let multiply = |x: &[f64]| {
        stiffness
            .iter()
            .map(|row| row.iter().map(|&(j, value)| value * x[j]).sum())
            .collect::<Vec<f64>>()
    };
    let factor = crate::sparse::Factor::new(&stiffness);
    for iteration in 0..limit {
        if converged {
            break;
        }
        let rotations: Vec<_> = elements.iter().map(|e| rotation(e, uv)).collect();
        let mut candidate = uv.clone();
        for axis in 0..2 {
            let mut rhs = vec![0.; n];
            for (ri, row) in rows.iter().enumerate() {
                let mut target =
                    rotations[ri / 2][axis * 2 + ri % 2] * elements[ri / 2].area.sqrt();
                for &(v, c) in row {
                    if index[v].is_none() {
                        target -= c * uv[v][axis];
                    }
                }
                for &(v, c) in row {
                    if let Some(i) = index[v] {
                        rhs[i] += c * target;
                    }
                }
            }
            let mut x: Vec<_> = factor
                .as_ref()
                .map(|f| f.solve(&rhs))
                .filter(|x| x.iter().all(|v| v.is_finite()))
                .unwrap_or_else(|| free.iter().map(|&v| uv[v][axis]).collect());
            let product = multiply(&x);
            let mut residual: Vec<_> = rhs.iter().zip(product).map(|(a, b)| a - b).collect();
            let mut z: Vec<_> = residual.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
            let mut direction = z.clone();
            let mut rz = inner(&residual, &z);
            let tolerance = 1e-10 * inner(&rhs, &rhs).sqrt().max(1.);
            let mut solved = inner(&residual, &residual).sqrt() <= tolerance;
            for _ in 0..2000 {
                if solved {
                    break;
                }
                let product = multiply(&direction);
                let denominator = inner(&direction, &product);
                if denominator < 1e-25 {
                    break;
                }
                let alpha = rz / denominator;
                for i in 0..n {
                    x[i] += alpha * direction[i];
                    residual[i] -= alpha * product[i];
                }
                solved = inner(&residual, &residual).sqrt() <= tolerance;
                if solved {
                    break;
                }
                z = residual.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
                let next = inner(&residual, &z);
                let beta = next / rz;
                for i in 0..n {
                    direction[i] = z[i] + beta * direction[i];
                }
                rz = next;
            }
            if !solved {
                return Err("ARAP_NOT_CONVERGED");
            }
            for (i, &v) in free.iter().enumerate() {
                candidate[v][axis] = x[i];
            }
        }
        let mut accepted = None;
        let mut step = 1.;
        for _ in 0..24 {
            let trial: Vec<_> = uv
                .iter()
                .zip(&candidate)
                .map(|(a, b)| [a[0] + step * (b[0] - a[0]), a[1] + step * (b[1] - a[1])])
                .collect();
            if positive(faces, &trial) {
                let e = objective(&trial);
                if e <= after + 1e-12 {
                    accepted = Some((trial, e));
                    break;
                }
            }
            step *= 0.5;
        }
        let Some((trial, e)) = accepted else {
            break;
        };
        iterations = iteration + 1;
        converged = (after - e).abs() < 1e-9 * after.max(1.);
        *uv = trial;
        after = e;
    }
    Ok(ArapReport {
        iterations,
        energy_before: before,
        energy_after: after,
        converged,
        reverted: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::{Face, Vertex};

    #[test]
    fn initial_anchor_distance_is_not_a_material_constraint() {
        let rest = [[0., 0.], [100., 0.], [100., 100.], [0., 100.]];
        let mut mesh = Mesh {
            repair_cuts: false,
            initial_uv: None,
            method: "arap".into(),
            iterations: Some(100),
            vertices: rest
                .iter()
                .enumerate()
                .map(|(i, p)| Vertex {
                    id: i.to_string(),
                    x_mm: p[0],
                    y_mm: p[1],
                    z_mm: 0.,
                })
                .collect(),
            faces: vec![
                Face {
                    id: "a".into(),
                    vertices: ["0".into(), "1".into(), "2".into()],
                    region: "panel".into(),
                },
                Face {
                    id: "b".into(),
                    vertices: ["0".into(), "2".into(), "3".into()],
                    region: "panel".into(),
                },
            ],
        };
        let mut uv = vec![[0., 0.], [80., 0.], [80., 100.], [0., 100.]];
        let report = refine(
            &mesh,
            &[0, 1, 2, 3],
            &[[0, 1, 2], [0, 2, 3]],
            &mut uv,
            [0, 1],
            100,
        )
        .unwrap();
        assert!(
            report.energy_after < 1e-9,
            "A free panel must not keep the initial anchor spacing: {}",
            report.energy_after
        );
        assert!((uv[1][0].hypot(uv[1][1]) - 100.).abs() < 1e-3);
        assert_eq!(uv[0], [0., 0.]);
        let ordinary = crate::surface::unwrap_mesh(&mesh).unwrap();
        mesh.method = "arap-balanced".into();
        let unchanged = crate::surface::unwrap_mesh(&mesh).unwrap();
        assert_eq!(
            serde_json::to_value(ordinary).unwrap(),
            serde_json::to_value(unchanged).unwrap(),
            "A successful ordinary solution must skip reweighting entirely"
        );
    }

    #[test]
    fn fixed_reweighting_saves_a_real_domain_without_adding_seams() {
        let fixture = include_str!("../../../tests/fixtures/arap-balanced-real-domain.json");
        for iterations in [30, 100] {
            let mut mesh: Mesh = serde_json::from_str(fixture).unwrap();
            mesh.iterations = Some(iterations);
            let ordinary = crate::surface::unwrap_mesh(&mesh).unwrap();
            assert_eq!(ordinary.len(), 1);
            assert!(ordinary[0].edge_error_max > 0.115);
            mesh.method = "arap-balanced".into();
            let balanced = crate::surface::unwrap_mesh(&mesh).unwrap();
            assert_eq!(
                balanced.len(),
                1,
                "A successful retry must not need a new seam"
            );
            let p = &balanced[0];
            assert_eq!(p.face_ids.len(), 62);
            assert_eq!(p.face_ids, ordinary[0].face_ids);
            assert!(p.area_error_max <= 0.15);
            assert!(p.edge_error_max <= 0.10);
            assert!(p.distortion_max <= 0.15);
            assert!(p.arap.as_ref().unwrap().converged);
            assert!(!p.arap.as_ref().unwrap().reverted);
            // The soft p95 warning remains; passing hard maxima is not a
            // license to lower the existing manufacturing review threshold.
            assert!(p.distortion_p95 > 0.05);
            assert_eq!(p.status, "needsReview");
        }
    }

    #[test]
    fn rejected_reweighting_keeps_the_ordinary_geometry_and_report() {
        let fixture = include_str!("../../../tests/fixtures/arap-balanced-real-domain.json");
        let mut mesh: Mesh = serde_json::from_str(fixture).unwrap();
        // A single iteration cannot turn this curved material into a valid chart.
        // Candidate energy reduction alone must not change the ordinary result.
        mesh.iterations = Some(1);
        let ordinary = crate::surface::unwrap_mesh(&mesh).unwrap();
        assert!(ordinary[0].edge_error_max > 0.10);
        mesh.method = "arap-balanced".into();
        let balanced = crate::surface::unwrap_mesh(&mesh).unwrap();
        assert_eq!(
            serde_json::to_value(ordinary).unwrap(),
            serde_json::to_value(balanced).unwrap()
        );
    }

    #[test]
    fn curved_panel_recovers_physical_seam_lengths_from_a_compressed_seed() {
        for scale in [0.001, 1., 1000.] {
            let vertices = [
                [0., 0., 0.],
                [100., 0., 0.],
                [100., 100., 0.],
                [0., 100., 0.],
                [50., 50., 20.],
            ];
            let faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
            let mesh = Mesh {
                repair_cuts: false,
                initial_uv: None,
                method: "arap-seamed".into(),
                iterations: Some(100),
                vertices: vertices
                    .iter()
                    .enumerate()
                    .map(|(i, p)| Vertex {
                        id: i.to_string(),
                        x_mm: p[0] * scale,
                        y_mm: p[1] * scale,
                        z_mm: p[2] * scale,
                    })
                    .collect(),
                faces: faces
                    .iter()
                    .enumerate()
                    .map(|(i, f)| Face {
                        id: i.to_string(),
                        vertices: f.map(|v| v.to_string()),
                        region: "panel".into(),
                    })
                    .collect(),
            };
            let mut uv: Vec<_> = vertices
                .iter()
                .map(|p| [p[0] * scale * 0.95, p[1] * scale * 0.95])
                .collect();
            refine(&mesh, &[0, 1, 2, 3, 4], &faces, &mut uv, [0, 1], 100).unwrap();
            assert!(positive(&faces, &uv));
            for i in 0..4 {
                let j = (i + 1) % 4;
                let length = (uv[i][0] - uv[j][0]).hypot(uv[i][1] - uv[j][1]);
                assert!(
                    (length / (100. * scale) - 1.).abs() < 0.0005,
                    "Curved patch seam {i} at scale {scale}: {length}"
                );
            }
            assert_eq!(uv[0], [0., 0.]);
        }
    }

    #[test]
    fn skinny_valid_triangle_keeps_its_isometric_embedding() {
        let mut uv = vec![[0., 0.], [100., 0.], [100., 0.0000001]];
        let mesh = Mesh {
            repair_cuts: false,
            initial_uv: None,
            method: "arap".into(),
            iterations: Some(30),
            vertices: uv
                .iter()
                .enumerate()
                .map(|(i, p)| Vertex {
                    id: i.to_string(),
                    x_mm: p[0],
                    y_mm: p[1],
                    z_mm: 0.,
                })
                .collect(),
            faces: vec![Face {
                id: "face".into(),
                vertices: ["0".into(), "1".into(), "2".into()],
                region: "panel".into(),
            }],
        };
        let before = uv.clone();
        let result = refine(&mesh, &[0, 1, 2], &[[0, 1, 2]], &mut uv, [0, 1], 30);
        assert!(
            result.is_ok(),
            "A nonzero cross-product area must not be lost to subtraction cancellation"
        );
        let report = result.unwrap();
        assert!(report.energy_after < 1e-12);
        assert_eq!(uv, before);
    }
}
