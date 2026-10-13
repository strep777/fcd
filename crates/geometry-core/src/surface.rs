use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vertex {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
    pub z_mm: f64,
}
#[derive(Clone, Deserialize)]
pub struct Face {
    pub id: String,
    pub vertices: [String; 3],
    pub region: String,
}
#[derive(Deserialize)]
pub struct Mesh {
    #[serde(default)]
    pub repair_cuts: bool,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub iterations: Option<usize>,
    pub vertices: Vec<Vertex>,
    pub faces: Vec<Face>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arap: Option<crate::arap::ArapReport>,
    pub face_distortion: Vec<FaceDistortion>,
    pub face_ids: Vec<String>,
    pub uv: Vec<Uv>,
    pub boundary: Vec<String>,
    pub area_error_max: f64,
    pub edge_error_max: f64,
    pub distortion_mean: f64,
    pub distortion_p95: f64,
    pub distortion_max: f64,
    pub status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDistortion {
    pub face_id: String,
    pub area_error: f64,
    pub edge_error: f64,
    pub angle_error: f64,
    pub distortion: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Uv {
    pub vertex_id: String,
    pub x_mm: f64,
    pub y_mm: f64,
}
fn sub(a: &Vertex, b: &Vertex) -> [f64; 3] {
    [a.x_mm - b.x_mm, a.y_mm - b.y_mm, a.z_mm - b.z_mm]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn length(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn oriented_key(a: usize, b: usize) -> (usize, usize) {
    (a.min(b), a.max(b))
}
fn norm2(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn angle(a: f64, b: f64, c: f64) -> f64 {
    ((a * a + b * b - c * c) / (2. * a * b))
        .clamp(-1., 1.)
        .acos()
}
fn overlapping(a: [usize; 3], b: [usize; 3], uv: &[[f64; 2]]) -> bool {
    let pa = a.map(|i| uv[i]);
    let pb = b.map(|i| uv[i]);
    let inside =
        |p: [f64; 2], r: [[f64; 2]; 3]| (0..3).all(|i| crate::numerical::orientation(r[i], r[(i + 1) % 3], p)>0);
    for (i, p) in pa.iter().enumerate() {
        if !b.contains(&a[i]) && inside(*p, pb) {
            return true;
        }
    }
    for (i, p) in pb.iter().enumerate() {
        if !a.contains(&b[i]) && inside(*p, pa) {
            return true;
        }
    }
    for i in 0..3 {
        for j in 0..3 {
            let (p, q, r, s) = (pa[i], pa[(i + 1) % 3], pb[j], pb[(j + 1) % 3]);
            if crate::numerical::orientation(p,q,r)*crate::numerical::orientation(p,q,s)<0
                && crate::numerical::orientation(r,s,p)*crate::numerical::orientation(r,s,q)<0
            {
                return true;
            }
        }
    }
    false
}
/// Conservative sweep broad phase; every intersecting box still receives exact triangle checks.
fn has_overlap(faces: &[[usize; 3]], uv: &[[f64; 2]]) -> Result<bool, &'static str> {
    let mut boxes: Vec<_> = faces
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let p = f.map(|v| uv[v]);
            (
                i,
                p.iter().map(|v| v[0]).fold(f64::INFINITY, f64::min),
                p.iter().map(|v| v[0]).fold(f64::NEG_INFINITY, f64::max),
                p.iter().map(|v| v[1]).fold(f64::INFINITY, f64::min),
                p.iter().map(|v| v[1]).fold(f64::NEG_INFINITY, f64::max),
            )
        })
        .collect();
    boxes.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    let mut active: Vec<(usize, f64, f64, f64, f64)> = vec![];
    let mut checks = 0usize;
    for current in boxes {
        active.retain(|other| other.2 >= current.1);
        for other in &active {
            checks += 1;
            if checks > 100_000_000 {
                return Err("RESOURCE_LIMIT");
            }
            if other.4 >= current.3
                && current.4 >= other.3
                && overlapping(faces[current.0], faces[other.0], uv)
            {
                return Ok(true);
            }
        }
        active.push(current);
    }
    Ok(false)
}
pub fn unwrap_mesh(mesh: &Mesh) -> Result<Vec<Patch>, &'static str> {
    if mesh.vertices.len() < 3
        || mesh.vertices.len() > 200_000
        || mesh.faces.is_empty()
        || mesh.faces.len() > 50_000
    {
        return Err("MESH_LIMIT");
    }
    let mut ids = BTreeMap::new();
    for (i, v) in mesh.vertices.iter().enumerate() {
        if [v.x_mm, v.y_mm, v.z_mm]
            .iter()
            .any(|n| !n.is_finite() || n.abs() > 1e6)
            || ids.insert(v.id.clone(), i).is_some()
        {
            return Err("INVALID_MESH");
        }
    }
    let mut faces = vec![];
    type MeshEdges = BTreeMap<(usize, usize), Vec<(usize, usize, usize)>>;
    let mut edges: MeshEdges = BTreeMap::new();
    let mut face_ids = BTreeSet::new();
    for (i, f) in mesh.faces.iter().enumerate() {
        if !face_ids.insert(&f.id) {
            return Err("INVALID_MESH");
        }
        let mut vertices = [0; 3];
        for (j, id) in f.vertices.iter().enumerate() {
            vertices[j] = *ids.get(id).ok_or("INVALID_MESH")?;
        }
        let [a, b, c] = vertices;
        if crate::numerical::area3([a,b,c].map(|i|{let v=&mesh.vertices[i];[v.x_mm,v.y_mm,v.z_mm]})).is_none() {
            return Err("DEGENERATE_MESH");
        }
        faces.push(vertices);
        for j in 0..3 {
            let (a, b) = (vertices[j], vertices[(j + 1) % 3]);
            edges.entry(oriented_key(a, b)).or_default().push((i, a, b));
        }
    }
    for values in edges.values() {
        if values.len() > 2 {
            return Err("NONMANIFOLD_MESH");
        }
        if values.len() == 2 && values[0].1 == values[1].1 {
            return Err("MESH_ORIENTATION");
        }
    }
    let mut adjacency = vec![vec![]; faces.len()];
    for values in edges.values() {
        if values.len() == 2 {
            let (a, b) = (values[0].0, values[1].0);
            if mesh.faces[a].region == mesh.faces[b].region {
                adjacency[a].push(b);
                adjacency[b].push(a);
            }
        }
    }
    let mut visited = vec![false; faces.len()];
    let mut patches = vec![];
    for start in 0..faces.len() {
        if visited[start] {
            continue;
        }
        let mut group = vec![];
        let mut queue = VecDeque::from([start]);
        visited[start] = true;
        while let Some(i) = queue.pop_front() {
            group.push(i);
            for &j in &adjacency[i] {
                if !visited[j] {
                    visited[j] = true;
                    queue.push_back(j);
                }
            }
        }
        group.sort_unstable();
        parameterize_with_cuts(mesh, &faces, &adjacency, &group, &mut patches)?;
        if patches.len() > 500 {
            return Err("MESH_LIMIT");
        }
    }
    Ok(patches)
}

// Only explicitly enabled automatic cuts may subdivide a patch that fails parameterization.
fn parameterize_with_cuts(
    mesh: &Mesh,
    faces: &[[usize; 3]],
    adjacency: &[Vec<usize>],
    group: &[usize],
    patches: &mut Vec<Patch>,
) -> Result<(), &'static str> {
    if patches.len() >= 500 {
        return Err("MESH_LIMIT");
    }
    match parameterize(mesh, faces, group) {
        Ok(patch) => {
            patches.push(patch);
            Ok(())
        }
        Err(code)
            if mesh.repair_cuts
                && group.len() > 1
                && matches!(
                    code,
                    "UNWRAP_OVERLAP"
                        | "UNWRAP_FLIPPED"
                        | "UNWRAP_NOT_CONVERGED"
                        | "PATCH_NOT_DISK"
                        | "PATCH_NEEDS_CUTS"
                        | "NUMERICAL_FAILURE"
                ) =>
        {
            let selected: BTreeSet<usize> = group.iter().copied().collect();
            let mut left = BTreeSet::new();
            let mut queue = VecDeque::from([group[0]]);
            while left.len() < group.len().div_ceil(2) {
                let i = queue.pop_front().ok_or("PATCH_NOT_DISK")?;
                if !left.insert(i) {
                    continue;
                }
                for &j in &adjacency[i] {
                    if selected.contains(&j) && !left.contains(&j) {
                        queue.push_back(j);
                    }
                }
            }
            let right: BTreeSet<usize> = selected.difference(&left).copied().collect();
            for subset in [left, right] {
                let mut remaining = subset;
                while let Some(&start) = remaining.iter().next() {
                    let mut component = vec![];
                    let mut queue = VecDeque::from([start]);
                    remaining.remove(&start);
                    while let Some(i) = queue.pop_front() {
                        component.push(i);
                        for &j in &adjacency[i] {
                            if remaining.remove(&j) {
                                queue.push_back(j);
                            }
                        }
                    }
                    component.sort_unstable();
                    parameterize_with_cuts(mesh, faces, adjacency, &component, patches)?;
                }
            }
            Ok(())
        }
        Err(code) => Err(code),
    }
}

// Slit boundaries contain distinct vertex IDs at the same physical point.
// A half-perimeter pair can therefore have zero or ill-conditioned distance.
fn separated_boundary_anchors(vertices: &[Vertex], boundary: &[usize]) -> (usize, usize) {
    let farthest = |from: usize| -> usize {
        *boundary.iter().max_by(|&&a, &&b| {
            length(sub(&vertices[a], &vertices[from])).total_cmp(&length(sub(&vertices[b], &vertices[from])))
        }).expect("nonempty boundary")
    };
    let first = farthest(boundary[0]);
    (first, farthest(first))
}

fn parameterize(mesh: &Mesh, faces: &[[usize; 3]], group: &[usize]) -> Result<Patch, &'static str> {
    if group.len() > 50_000 {
        return Err("PATCH_LIMIT");
    }
    let used: BTreeSet<_> = group.iter().flat_map(|&i| faces[i]).collect();
    let globals: Vec<_> = used.into_iter().collect();
    let locals: BTreeMap<_, _> = globals.iter().enumerate().map(|(l, &g)| (g, l)).collect();
    let mut edges: BTreeMap<(usize, usize), Vec<(usize, usize)>> = BTreeMap::new();
    for &i in group {
        let f = faces[i];
        for j in 0..3 {
            edges
                .entry(oriented_key(f[j], f[(j + 1) % 3]))
                .or_default()
                .push((f[j], f[(j + 1) % 3]));
        }
    }
    let mut next = BTreeMap::new();
    let mut incoming = BTreeSet::new();
    for values in edges.values().filter(|v| v.len() == 1) {
        let (a, b) = values[0];
        if next.insert(a, b).is_some() || !incoming.insert(b) {
            return Err("PATCH_NOT_DISK");
        }
    }
    let start = *next.keys().next().ok_or("PATCH_NEEDS_CUTS")?;
    let mut boundary = vec![start];
    let mut current = start;
    loop {
        current = *next.get(&current).ok_or("PATCH_NOT_DISK")?;
        if current == start {
            break;
        }
        if boundary.contains(&current) {
            return Err("PATCH_NOT_DISK");
        }
        boundary.push(current);
    }
    if boundary.len() != next.len() || globals.len() + group.len() != edges.len() + 1 {
        return Err("PATCH_NOT_DISK");
    }
    let (first, second) = separated_boundary_anchors(&mesh.vertices, &boundary);
    let pinned_length = length(sub(&mesh.vertices[first], &mesh.vertices[second]));
    if !pinned_length.is_finite() || pinned_length<=0. {
        return Err("NUMERICAL_FAILURE");
    }
    let fixed = BTreeMap::from([
        (locals[&first] * 2, 0.),
        (locals[&first] * 2 + 1, 0.),
        // Solve in unit UV coordinates; the measured edge fit below restores mm.
        (locals[&second] * 2, 1.),
        (locals[&second] * 2 + 1, 0.),
    ]);
    let n = globals.len() * 2;
    let mut free_index = vec![None; n];
    let mut count = 0;
    for (i, item) in free_index.iter_mut().enumerate() {
        if !fixed.contains_key(&i) {
            *item = Some(count);
            count += 1;
        }
    }
    let mut rows: Vec<(Vec<(usize, f64)>, f64)> = vec![];
    let mut area3 = vec![];
    for &i in group {
        let [a, b, c] = faces[i];
        let e1 = sub(&mesh.vertices[b], &mesh.vertices[a]);
        let e2 = sub(&mesh.vertices[c], &mesh.vertices[a]);
        let l = length(e1);
        let x = dot(e1, e2) / l;
        let h = length(cross(e1, e2)) / l;
        let area = l * h / 2.;
        area3.push(area);
        let w = area.sqrt();
        let gx = [-1. / l, 1. / l, 0.];
        let gy = [(x - l) / (l * h), -x / (l * h), 1. / h];
        let indices = [locals[&a], locals[&b], locals[&c]];
        for imaginary in [false, true] {
            let mut coefficients = vec![];
            let mut rhs = 0.;
            for j in 0..3 {
                let terms = if imaginary {
                    [(indices[j] * 2, gy[j] * w), (indices[j] * 2 + 1, gx[j] * w)]
                } else {
                    [
                        (indices[j] * 2, gx[j] * w),
                        (indices[j] * 2 + 1, -gy[j] * w),
                    ]
                };
                for (index, value) in terms {
                    if let Some(&v) = fixed.get(&index) {
                        rhs -= value * v;
                    } else {
                        coefficients.push((free_index[index].unwrap(), value));
                    }
                }
            }
            rows.push((coefficients, rhs));
        }
    }
    let mut rhs = vec![0.; count];
    let mut diagonal = vec![0.; count];
    for (row, b) in &rows {
        for &(i, c) in row {
            rhs[i] += c * b;
            diagonal[i] += c * c;
        }
    }
    if diagonal.iter().any(|&d| d < 1e-14) {
        return Err("NUMERICAL_FAILURE");
    }
    let multiply = |x: &[f64]| {
        let mut y = vec![0.; count];
        for (row, _) in &rows {
            let v: f64 = row.iter().map(|&(i, c)| x[i] * c).sum();
            for &(i, c) in row {
                y[i] += c * v;
            }
        }
        y
    };
    let inner = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
    let mut solution = vec![0.; count];
    let mut r = rhs.clone();
    let mut z: Vec<_> = r.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
    let mut direction = z.clone();
    let mut rz = inner(&r, &z);
    let initial = inner(&rhs, &rhs).sqrt();
    let mut converged = initial < 1e-12;
    for _ in 0..3000 {
        if converged {
            break;
        }
        let ad = multiply(&direction);
        let denom = inner(&direction, &ad);
        if denom <= 1e-25 {
            return Err("NUMERICAL_FAILURE");
        }
        let alpha = rz / denom;
        for i in 0..count {
            solution[i] += alpha * direction[i];
            r[i] -= alpha * ad[i];
        }
        if inner(&r, &r).sqrt() <= 1e-9 * initial.max(1.) {
            converged = true;
            break;
        }
        z = r.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
        let next = inner(&r, &z);
        let beta = next / rz;
        for i in 0..count {
            direction[i] = z[i] + beta * direction[i];
        }
        rz = next;
    }
    if !converged {
        return Err("UNWRAP_NOT_CONVERGED");
    }
    let coordinate = |i: usize| {
        fixed
            .get(&i)
            .copied()
            .unwrap_or_else(|| solution[free_index[i].unwrap()])
    };
    let mut uv: Vec<[f64; 2]> = (0..globals.len())
        .map(|i| [coordinate(2 * i), coordinate(2 * i + 1)])
        .collect();
    let mut numerator = 0.;
    let mut denominator = 0.;
    for &(a, b) in edges.keys() {
        let l2 = norm2(uv[locals[&a]], uv[locals[&b]]);
        let l3 = length(sub(&mesh.vertices[a], &mesh.vertices[b]));
        numerator += l2 * l3;
        denominator += l2 * l2;
    }
    if !denominator.is_finite() || denominator<=0. {
        return Err("NUMERICAL_FAILURE");
    }
    let scale = numerator / denominator;
    for p in &mut uv {
        p[0] *= scale;
        p[1] *= scale;
    }
    let local_faces: Vec<_> = group
        .iter()
        .map(|&i| faces[i].map(|g| locals[&g]))
        .collect();
    let initial_uv = uv.clone();
    let mut arap = if mesh.method == "arap" || mesh.method == "arap-balanced" {
        Some(crate::arap::refine(
            mesh,
            &globals,
            &local_faces,
            &mut uv,
            [locals[&first], locals[&second]],
            mesh.iterations.unwrap_or(30).clamp(1, 100),
        )?)
    } else {
        None
    };
    if arap.is_some() && has_overlap(&local_faces, &uv)? {
        uv = initial_uv;
        if let Some(report) = &mut arap {
            report.energy_after = report.energy_before;
            report.reverted = true;
            report.converged = false;
        }
    }
    if mesh.method == "arap-balanced"
        && crate::arap::quality_ratios(mesh, &globals, &local_faces, &uv)
            .iter().any(|&r| r > 1.)
    {
        // Retry only a failed ordinary solution. Never trade one hard failure
        // for a smaller average: every face and all nonlocal overlaps must pass.
        let mut candidate = uv.clone();
        if let Ok(report) = crate::arap::refine_balanced(
            mesh,
            &globals,
            &local_faces,
            &mut candidate,
            [locals[&first], locals[&second]],
            mesh.iterations.unwrap_or(30).clamp(1, 100),
        ) {
            if report.converged
                && crate::arap::quality_ratios(mesh, &globals, &local_faces, &candidate)
                    .iter().all(|&r| r <= 1.)
                && matches!(has_overlap(&local_faces, &candidate), Ok(false))
            {
                uv = candidate;
                arap = Some(report);
            }
        }
    }
    let mut face_distortion = vec![];
    let mut errors = vec![];
    let mut max_area: f64 = 0.;
    let mut max_edge: f64 = 0.;
    let mut weighted = 0.;
    let mut total_area = 0.;
    for (index, f) in local_faces.iter().enumerate() {
        let p = f.map(|i| uv[i]);
        let a2 = crate::numerical::positive_area2(p).ok_or("UNWRAP_FLIPPED")?;
        let ea = (a2 / area3[index] - 1.).abs();
        let f3 = faces[group[index]];
        let l3: [f64; 3] = std::array::from_fn(|i| {
            length(sub(&mesh.vertices[f3[i]], &mesh.vertices[f3[(i + 1) % 3]]))
        });
        let l2: [f64; 3] = std::array::from_fn(|i| norm2(p[i], p[(i + 1) % 3]));
        let ee = (0..3)
            .map(|i| (l2[i] / l3[i] - 1.).abs())
            .fold(0., f64::max);
        let et = (0..3)
            .map(|i| {
                (angle(l3[i], l3[(i + 1) % 3], l3[(i + 2) % 3])
                    - angle(l2[i], l2[(i + 1) % 3], l2[(i + 2) % 3]))
                .abs()
                    / std::f64::consts::PI
            })
            .fold(0., f64::max);
        let d = 0.4 * ea + 0.4 * ee + 0.2 * et;
        max_area = max_area.max(ea);
        max_edge = max_edge.max(ee);
        face_distortion.push(FaceDistortion {
            face_id: mesh.faces[group[index]].id.clone(),
            area_error: ea,
            edge_error: ee,
            angle_error: et,
            distortion: d,
        });
        errors.push(d);
        weighted += area3[index] * d;
        total_area += area3[index];
    }
    if has_overlap(&local_faces, &uv)? {
        return Err("UNWRAP_OVERLAP");
    }
    errors.sort_by(f64::total_cmp);
    let p95 = errors[((errors.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)];
    let max = *errors.last().unwrap();
    let min_x = uv.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
    let min_y = uv.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    Ok(Patch {
        face_distortion,
        face_ids: group.iter().map(|&i| mesh.faces[i].id.clone()).collect(),
        uv: globals
            .iter()
            .enumerate()
            .map(|(i, &g)| Uv {
                vertex_id: mesh.vertices[g].id.clone(),
                x_mm: uv[i][0] - min_x,
                y_mm: uv[i][1] - min_y,
            })
            .collect(),
        boundary: boundary
            .iter()
            .map(|&g| mesh.vertices[g].id.clone())
            .collect(),
        area_error_max: max_area,
        edge_error_max: max_edge,
        distortion_mean: weighted / total_area,
        distortion_p95: p95,
        distortion_max: max,
        status: if p95 <= 0.05
            && max_area <= 0.15
            && max_edge <= 0.10
            && arap.as_ref().is_none_or(|r| r.converged)
        {
            "acceptable"
        } else {
            "needsReview"
        }
        .into(),
        arap,
    })
}

#[cfg(test)]
mod design_anchor_tests {
    use super::*;
    #[test]
    fn seam_copies_at_half_arc_are_not_coincident_anchors() {
        let vertices: Vec<Vertex> = [10., 20., 10., 0.].iter().enumerate().map(|(i, &x)| Vertex {id:i.to_string(),x_mm:x,y_mm:0.,z_mm:0.}).collect();
        let (a,b)=separated_boundary_anchors(&vertices,&[0,1,2,3]);
        assert!(length(sub(&vertices[a],&vertices[b])) >= 19.);
    }
}

#[cfg(test)]mod numerical_unwrap_tests{
 use super::*;
 fn mesh(points:&[[f64;3]],faces:&[[usize;3]],method:&str)->Mesh{Mesh{repair_cuts:false,method:method.into(),iterations:Some(100),vertices:points.iter().enumerate().map(|(i,p)|Vertex{id:i.to_string(),x_mm:p[0],y_mm:p[1],z_mm:p[2]}).collect(),faces:faces.iter().enumerate().map(|(i,f)|Face{id:i.to_string(),vertices:f.map(|n|n.to_string()),region:"panel".into()}).collect()}}
 #[test]fn real_small_triangles_complete_lscm_and_arap_without_distortion(){let fixtures:Vec<serde_json::Value>=serde_json::from_str(include_str!("../../../tests/fixtures/material-numerical-validity.json")).unwrap();for method in ["lscm","arap"]{for row in &fixtures{let p:[[f64;3];3]=std::array::from_fn(|i|std::array::from_fn(|j|row["points"][i][j].as_f64().unwrap()));let result=unwrap_mesh(&mesh(&p,&[[0,1,2]],method));if row["valid"].as_bool().unwrap(){let patches=result.unwrap();assert_eq!(patches.len(),1);assert!(patches[0].area_error_max<1e-5,"{} area {}",method,patches[0].area_error_max);assert!(patches[0].edge_error_max<1e-5);assert_eq!(patches[0].status,"acceptable");}else{assert!(matches!(result,Err("DEGENERATE_MESH")));}}}}
 #[test]fn scaled_translated_and_mixed_size_faces_keep_the_hard_metrics(){for method in ["lscm","arap"]{for scale in [1e-6,1.,1000.]{for offset in [0.,1000.]{let points=[[0.,0.,0.],[1e-4,0.,0.],[0.,1e-4,0.],[1.,0.,0.],[0.,1.,0.]].map(|p|[offset+scale*p[0],offset+scale*p[1],scale*p[2]]);let patches=unwrap_mesh(&mesh(&points,&[[0,1,2],[1,3,4],[1,4,2]],method)).unwrap();assert_eq!(patches.len(),1);assert_eq!(patches[0].face_ids.len(),3);assert!(patches[0].area_error_max<=0.15,"{} {} {} area {}",method,scale,offset,patches[0].area_error_max);assert!(patches[0].edge_error_max<=0.10);assert!(patches[0].distortion_max<=1.);}}}}
 #[test]fn flipped_uv_and_exact_degeneracy_are_still_rejected(){let m=mesh(&[[0.,0.,0.],[1e-4,0.,0.],[0.,1e-4,0.]],&[[0,1,2]],"arap");let mut uv=vec![[0.,0.],[0.,1e-4],[1e-4,0.]];assert!(crate::arap::quality_ratios(&m,&[0,1,2],&[[0,1,2]],&uv)[0].is_infinite());assert!(matches!(crate::arap::refine(&m,&[0,1,2],&[[0,1,2]],&mut uv,[0,1],10),Err("UNWRAP_FLIPPED")));assert!(matches!(unwrap_mesh(&mesh(&[[0.,0.,0.],[1.,0.,0.],[2.,0.,0.]],&[[0,1,2]],"lscm")),Err("DEGENERATE_MESH")));}
}
