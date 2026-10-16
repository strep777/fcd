// Generated from packages/schema/index.ts. Do not edit by hand.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Point {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Curve {
    pub id: String,
    pub start_node_id: String,
    pub end_node_id: String,
    pub c1: Point,
    pub c2: Point,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Notch {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_seam_id: Option<String>,
    pub node_id: String,
    pub position: f64,
    pub depth_mm: f64,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Label {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllowanceSample {
    pub s: f64,
    pub width_mm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeAllowance {
    pub node_id: String,
    pub end_node_id: String,
    pub samples: Vec<AllowanceSample>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Piece {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_mask_id: Option<String>,
    pub id: String,
    pub name: String,
    pub nodes: Vec<Point>,
    pub closed: bool,
    pub allowance_mm: f64,
    pub cut_qty: u32,
    pub mirror: bool,
    pub material: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grain_rad: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowance_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_allowances: Option<Vec<EdgeAllowance>>,
    pub fur_rad: f64,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holes: Option<Vec<Vec<Point>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curves: Option<Vec<Curve>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub miter_limit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notches: Option<Vec<Notch>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<Label>>,
}
