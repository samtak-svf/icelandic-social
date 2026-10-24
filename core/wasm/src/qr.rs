//! The link code as a QR matrix; the page draws it as SVG.
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Qr {
    /// Modules per side.
    pub size: usize,
    /// Row-major, `size * size` long: 1 is dark, 0 is light.
    pub modules: Vec<u8>,
}

pub fn link_qr(_code: &str) -> Result<Qr, String> {
    unimplemented!()
}
