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
        crate::numerical::positive_area2([a,b,c]).is_some()
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
        assert_eq!(serde_json::to_value(ordinary).unwrap(), serde_json::to_value(unchanged).unwrap(),
            "A successful ordinary solution must skip reweighting entirely");
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
            assert_eq!(balanced.len(), 1, "A successful retry must not need a new seam");
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
        assert_eq!(serde_json::to_value(ordinary).unwrap(), serde_json::to_value(balanced).unwrap());
    }

    #[test]
    fn skinny_valid_triangle_keeps_its_isometric_embedding() {
        let mut uv = vec![[0., 0.], [100., 0.], [100., 0.0000001]];
        let mesh = Mesh {
            repair_cuts: false,
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

/// One fixed, bounded reweighting of measured hard-quality failures. This is
/// only a proposal: the caller must recheck every face and nonlocal overlaps.
pub fn refine_balanced(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &mut Vec<[f64; 2]>,
    anchors: [usize; 2],
    limit: usize,
) -> Result<ArapReport, &'static str> {
    let weights: Vec<_> = quality_ratios(mesh, globals, faces, uv)
        .into_iter()
        .map(|ratio| ratio.max(1.).powi(6).min(64.))
        .collect();
    refine_with_weights(mesh, globals, faces, uv, anchors, limit, Some(&weights))
}

/// Ratios to the existing maximum area, edge and combined distortion limits.
/// Physical triangle areas are measured by cross products, never by subtraction.
pub fn quality_ratios(
    mesh: &Mesh,
    globals: &[usize],
    faces: &[[usize; 3]],
    uv: &[[f64; 2]],
) -> Vec<f64> {
    faces.iter().map(|f| {
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
            - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0])) / 2.;
        if crate::numerical::positive_area2(p).is_none() || crate::numerical::area3(xyz.map(|v|[v.x_mm,v.y_mm,v.z_mm])).is_none() {
            return f64::INFINITY;
        }
        let ea = (projected / area - 1.).abs();
        let l3: [f64; 3] = std::array::from_fn(|i| {
            let a = xyz[i];
            let b = xyz[(i + 1) % 3];
            (b.x_mm - a.x_mm).hypot(b.y_mm - a.y_mm).hypot(b.z_mm - a.z_mm)
        });
        let l2: [f64; 3] = std::array::from_fn(|i| {
            (p[(i + 1) % 3][0] - p[i][0]).hypot(p[(i + 1) % 3][1] - p[i][1])
        });
        let ee = (0..3)
            .map(|i| (l2[i] / l3[i] - 1.).abs())
            .fold(0., f64::max);
        let angle = |a: f64, b: f64, c: f64| {
            ((a * a + b * b - c * c) / (2. * a * b)).clamp(-1., 1.).acos()
        };
        let et = (0..3)
            .map(|i| {
                (angle(l3[i], l3[(i + 1) % 3], l3[(i + 2) % 3])
                    - angle(l2[i], l2[(i + 1) % 3], l2[(i + 2) % 3])).abs()
                    / std::f64::consts::PI
            })
            .fold(0., f64::max);
        (ea / 0.15).max(ee / 0.10).max((0.4 * ea + 0.4 * ee + 0.2 * et) / 0.15)
    }).collect()
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
    if faces.iter().any(|f|crate::numerical::area3(f.map(|i|{let v=&mesh.vertices[globals[i]];[v.x_mm,v.y_mm,v.z_mm]})).is_none()){return Err("NUMERICAL_FAILURE");}
    // Unit patch coordinates make CG residuals independent of physical size.
    // Rest lengths, UVs and energy use the same scale; reports remain dimensionless.
    let scale=faces.iter().flat_map(|f|(0..3).map(move |i|(f[i],f[(i+1)%3]))).map(|(a,b)|{
        let a=&mesh.vertices[globals[a]];let b=&mesh.vertices[globals[b]];(a.x_mm-b.x_mm).hypot(a.y_mm-b.y_mm).hypot(a.z_mm-b.z_mm)
    }).fold(0.,f64::max);
    if !scale.is_finite()||scale<=0.{return Err("NUMERICAL_FAILURE");}
    let origin=&mesh.vertices[globals[anchors[0]]];let uv_origin=uv[anchors[0]];
    let conditioned=Mesh{repair_cuts:mesh.repair_cuts,method:mesh.method.clone(),iterations:mesh.iterations,vertices:mesh.vertices.iter().map(|v|crate::surface::Vertex{id:v.id.clone(),x_mm:(v.x_mm-origin.x_mm)/scale,y_mm:(v.y_mm-origin.y_mm)/scale,z_mm:(v.z_mm-origin.z_mm)/scale}).collect(),faces:mesh.faces.clone()};
    let mut local:Vec<_>=uv.iter().map(|p|[(p[0]-uv_origin[0])/scale,(p[1]-uv_origin[1])/scale]).collect();
    let report=refine_conditioned(&conditioned,globals,faces,&mut local,anchors,limit,weights)?;
    if report.iterations>0{*uv=local.iter().map(|p|[p[0]*scale+uv_origin[0],p[1]*scale+uv_origin[1]]).collect();}Ok(report)
}
fn refine_conditioned(mesh:&Mesh,globals:&[usize],faces:&[[usize;3]],uv:&mut Vec<[f64;2]>,anchors:[usize;2],limit:usize,weights:Option<&[f64]>)->Result<ArapReport,&'static str>{
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
        if crate::numerical::area3([a,b,c].map(|v|[v.x_mm,v.y_mm,v.z_mm])).is_none() {
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
    let before = energy(&elements, uv);
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
    let multiply = |x: &[f64]| {
        let mut out = vec![0.; n];
        for row in &rows {
            let value: f64 = row
                .iter()
                .filter_map(|&(v, c)| index[v].map(|i| x[i] * c))
                .sum();
            for &(v, c) in row {
                if let Some(i) = index[v] {
                    out[i] += c * value;
                }
            }
        }
        out
    };
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
            let mut x: Vec<_> = free.iter().map(|&v| uv[v][axis]).collect();
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
                let e = energy(&elements, &trial);
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
