use clipper2_rust::{difference_64, intersect_64, union_64, FillRule, Paths64, Point64};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipJob {
    pub subjects: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    pub clips: Option<Vec<Vec<[f64; 2]>>>,
    #[serde(default)]
    pub subtract: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    pub union: bool,
    #[serde(default)]
    pub precision_digits: Option<u32>,
    #[serde(default)]
    pub origin: Option<[f64; 2]>,
}
#[derive(Serialize)]
pub struct ClipResult {
    pub rings: Vec<Vec<[f64; 2]>>,
}
pub fn batch(jobs: Vec<ClipJob>) -> Result<Vec<ClipResult>, &'static str> {
    if jobs.len() > 5000 {
        return Err("RESOURCE_LIMIT");
    }
    let mut points = 0;
    let mut output = vec![];
    for job in jobs {
        let precision = job.precision_digits.unwrap_or(4);
        if !(4..=12).contains(&precision) {
            return Err("VALIDATION_ERROR");
        }
        // Local coordinates retain intersection precision for nearly parallel
        // UV boundaries. Keep scaled coordinates below the reliable 1e15 range,
        // well below Clipper's integer limit. Legacy jobs retain their origin.
        let mut scale = 10_f64.powi(precision as i32);
        if job.origin.is_some_and(|p| p.iter().any(|n| !n.is_finite() || n.abs() > 1e6)) {
            return Err("VALIDATION_ERROR");
        }
        // Related face-local booleans must share a lattice. Other callers
        // retain the local origin needed for large translated UV coordinates.
        let origin = job.origin.unwrap_or_else(|| if precision > 4 {
            job.subjects.first().and_then(|r| r.first()).copied().unwrap_or([0.,0.])
        } else { [0.,0.] });
        let extent = job.subjects.iter().chain(job.clips.as_deref().unwrap_or(&[]).iter()).chain(job.subtract.iter())
            .flat_map(|ring| ring.iter()).flat_map(|p| p.iter().enumerate().map(|(i,x)| (x-origin[i]).abs()))
            .fold(0_f64, f64::max);
        // precision_digits is the desired upper precision, not a smaller size
        // budget. Long valid garments get the highest safe local grid.
        while extent * scale > 1e15 && scale > 1e4 { scale /= 10.; }
        let mut convert = |rings: &Vec<Vec<[f64; 2]>>| -> Result<Paths64, &'static str> {
            let mut paths = vec![];
            for ring in rings {
                if ring.len() < 3 {
                    return Err("INVALID_GEOMETRY");
                }
                points += ring.len();
                if points > 200000
                    || ring
                        .iter()
                        .flatten()
                        .any(|x| !x.is_finite() || x.abs() > 1e6)
                    || ring.iter().any(|p| p.iter().enumerate().any(|(i,x)| ((x-origin[i])*scale).abs() > 1e15))
                {
                    return Err("RESOURCE_LIMIT");
                }
                paths.push(
                    ring.iter()
                        .map(|p| {
                            Point64::new(
                                ((p[0]-origin[0]) * scale).round() as i64,
                                ((p[1]-origin[1]) * scale).round() as i64,
                            )
                        })
                        .collect(),
                );
            }
            Ok(paths)
        };
        let subjects = convert(&job.subjects)?;
        let mut result = if job.union {
            union_64(&subjects, &vec![], FillRule::NonZero)
        } else if let Some(clips) = job.clips {
            intersect_64(&subjects, &convert(&clips)?, FillRule::EvenOdd)
        } else {
            subjects
        };
        if !job.subtract.is_empty() {
            result = difference_64(&result, &convert(&job.subtract)?, FillRule::NonZero);
        }
        output.push(ClipResult {
            rings: result
                .iter()
                .map(|r| {
                    r.iter()
                        .map(|p| [p.x as f64 / scale + origin[0], p.y as f64 / scale + origin[1]])
                        .collect()
                })
                .collect(),
        });
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn related_booleans_share_a_grid_independent_of_ring_start() {
        let ring = vec![[0.0000000037,0.0000000041],[10.1234567892,0.0000000041],
            [10.1234567892,10.2345678913],[0.0000000037,10.2345678913]];
        let mut rotated = ring.clone();
        rotated.rotate_left(1);
        let make = |subjects| ClipJob {subjects:vec![subjects],
            clips:Some(vec![vec![[1.1111111114,0.],[20.,0.],[20.,9.9999999993],[1.1111111114,9.9999999993]]]),
            subtract:vec![],union:false,precision_digits:Some(9),origin:Some([0.,0.])};
        let results = batch(vec![make(ring),make(rotated)]).unwrap();
        let ordered = |r:&ClipResult| {let mut p = r.rings.concat();p.sort_by(|a,b|
            a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));p};
        assert_eq!(results[0].rings.len(),1);
        assert_eq!(ordered(&results[0]),ordered(&results[1]));
        for p in &results[0].rings[0] {
            assert!((p[0]*1e9-(p[0]*1e9).round()).abs()<0.00001);
            assert!((p[1]*1e9-(p[1]*1e9).round()).abs()<0.00001);
        }
    }
    #[test]
    fn explicit_clip_origins_are_finite_and_bounded() {
        for origin in [[f64::NAN,0.],[0.,f64::INFINITY],[1000001.,0.]] {
            let job = ClipJob {subjects:vec![vec![[0.,0.],[1.,0.],[0.,1.]]],clips:None,
                subtract:vec![],union:true,precision_digits:Some(9),origin:Some(origin)};
            assert_eq!(batch(vec![job]).err(),Some("VALIDATION_ERROR"));
        }
    }
    #[test]
    fn high_precision_preserves_subgrid_faces_and_defaults_stay_compatible() {
        let make = |digits| ClipJob {subjects: vec![vec![[0.,0.],[10.,0.],[10.,0.00001]]], clips: None, subtract: vec![], union: true, precision_digits: digits,origin:None};
        assert!(batch(vec![make(None)]).unwrap()[0].rings.is_empty());
        assert_eq!(batch(vec![make(Some(8))]).unwrap()[0].rings.len(),1);
        assert_eq!(batch(vec![make(Some(13))]).err(),Some("VALIDATION_ERROR"));
    }
    #[test]
    fn high_precision_coordinate_budget_remains_bounded() {
        let make = |x| ClipJob {subjects:vec![vec![[x,0.],[x,1.],[x-1.,1.]]],clips:None,subtract:vec![],union:true,precision_digits:Some(12),origin:None};
        assert_eq!(batch(vec![make(1e6)]).unwrap()[0].rings.len(),1);
        assert_eq!(batch(vec![make(1e6+1.)]).err(),Some("RESOURCE_LIMIT"));
        let wide = ClipJob {subjects:vec![vec![[0.,0.],[1001.,0.],[1001.,1.]]],clips:None,subtract:vec![],union:true,precision_digits:Some(12),origin:None};
        let result = batch(vec![wide]).unwrap();
        assert_eq!(result[0].rings.len(),1);
        assert!(result[0].rings[0].iter().any(|p| (p[0]-1001.).abs()<1e-9));
    }
    #[test]
    fn local_intersection_retains_a_tiny_near_parallel_color_at_high_coordinates() {
        let job=ClipJob {subjects:vec![vec![[100000.,200000.],[100100.,200000.],[100100.,200000.00001]]],
            clips:Some(vec![vec![[100050.,200000.],[100100.,200000.],[100100.,200001.],[100050.,200001.]]]),
            subtract:vec![],union:false,precision_digits:Some(12),origin:None};
        let result=batch(vec![job]).unwrap();assert_eq!(result[0].rings.len(),1);
        let ring=&result[0].rings[0];let origin=ring[0];
        let area=ring.iter().enumerate().map(|(i,p)| {let q=ring[(i+1)%ring.len()];(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1])}).sum::<f64>().abs()/2.;
        assert!((area-0.000375).abs()<1e-7);
        assert!(ring.iter().all(|p|p[0]>=100050.-1e-8&&p[0]<=100100.+1e-8));
    }
}
