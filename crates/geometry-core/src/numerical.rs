//! Numerical validity has no physical area floor. Bound coordinate-subtraction
//! and product roundoff instead, including rounding of transformed coordinates.
//! A safety factor reserves direction/area accuracy before inverse gradients.
const SAFETY: f64 = 16.;
fn difference(a:f64,b:f64)->(f64,f64){(b-a,f64::EPSILON*(a.abs()+b.abs()+(b-a).abs()))}
fn product(a:f64,ea:f64,b:f64,eb:f64)->f64{a.abs()*eb+b.abs()*ea+ea*eb+f64::EPSILON*(a*b).abs()}
pub fn area3(p:[[f64;3];3])->Option<f64>{
 if p.iter().flatten().any(|v|!v.is_finite()){return None;}
 let u=std::array::from_fn::<_,3,_>(|i|difference(p[0][i],p[1][i]));
 let v=std::array::from_fn::<_,3,_>(|i|difference(p[0][i],p[2][i]));
 let mut cross=[0.;3];let mut errors=[0.;3];
 for i in 0..3{let j=(i+1)%3;let k=(i+2)%3;cross[i]=u[j].0*v[k].0-u[k].0*v[j].0;errors[i]=product(u[j].0,u[j].1,v[k].0,v[k].1)+product(u[k].0,u[k].1,v[j].0,v[j].1)+f64::EPSILON*cross[i].abs();}
 let magnitude=cross[0].hypot(cross[1]).hypot(cross[2]);let bound=SAFETY*errors[0].hypot(errors[1]).hypot(errors[2]);
 if magnitude.is_finite()&&magnitude>bound&&magnitude/2.>0.{Some(magnitude/2.)}else{None}
}
pub fn orientation(a:[f64;2],b:[f64;2],c:[f64;2])->i8{
 let Some((det,bound))=determinant(a,b,c)else{return 0;};if det>bound{1}else if det< -bound{-1}else{0}
}
pub(crate) fn determinant(a:[f64;2],b:[f64;2],c:[f64;2])->Option<(f64,f64)>{
 if [a,b,c].iter().flatten().any(|v|!v.is_finite()){return None;}
 let (ux,ex)=difference(a[0],b[0]);let (uy,ey)=difference(a[1],b[1]);let (vx,fx)=difference(a[0],c[0]);let (vy,fy)=difference(a[1],c[1]);let det=ux*vy-uy*vx;
 let bound=SAFETY*(product(ux,ex,vy,fy)+product(uy,ey,vx,fx)+f64::EPSILON*det.abs());
 if det.is_finite()&&bound.is_finite(){Some((det,bound))}else{None}
}
pub fn positive_area2(p:[[f64;2];3])->Option<f64>{let (det,bound)=determinant(p[0],p[1],p[2])?;if det>bound&&det/2.>0.{Some(det/2.)}else{None}}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn small_well_shaped_is_not_degenerate(){for scale in [1e-6,1e-3,1.,1000.]{for offset in [0.,1000.,1e6]{let p=[[offset,offset,0.],[offset+scale,offset,0.],[offset,offset+scale,0.]];assert!(area3(p).is_some());let uv=p.map(|v|[v[0],v[1]]);assert!(positive_area2(uv).is_some());assert!(positive_area2([uv[0],uv[2],uv[1]]).is_none());}}}
 #[test]fn rejects_zero_nonfinite_and_unresolvable_needle(){assert!(area3([[0.;3];3]).is_none());assert!(area3([[0.;3],[1.,0.,0.],[2.,0.,0.]]).is_none());assert!(area3([[f64::NAN,0.,0.],[1.,0.,0.],[0.,1.,0.]]).is_none());assert!(area3([[822.49169921875,953.9535317280757,-10.723844438245392],[822.0910006793049,953.1285724963226,-7.0892514112964],[822.0910007805172,953.1285727047037,-7.08925232936553]]).is_none());}
 #[test]fn actual_material_ears_keep_all_twenty_one_good_shapes(){let fixtures:Vec<serde_json::Value>=serde_json::from_str(include_str!("../../../tests/fixtures/material-numerical-validity.json")).unwrap();let mut kept=0;for row in fixtures{let p=std::array::from_fn(|i|std::array::from_fn(|j|row["points"][i][j].as_f64().unwrap()));let valid=row["valid"].as_bool().unwrap();assert_eq!(area3(p).is_some(),valid);kept+=usize::from(valid);}assert_eq!(kept,21);}
}
