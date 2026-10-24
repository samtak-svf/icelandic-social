//! The link code as a QR matrix; the page draws it as SVG.
use qrcode::{Color, QrCode};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Qr {
    /// Modules per side.
    pub size: usize,
    /// Row-major, `size * size` long: 1 is dark, 0 is light.
    pub modules: Vec<u8>,
}

/// The matrix for `code`; text no QR version holds is an error.
pub fn link_qr(code: &str) -> Result<Qr, String> {
    let qr = QrCode::new(code.as_bytes()).map_err(|error| error.to_string())?;
    Ok(Qr {
        size: qr.width(),
        modules: qr
            .to_colors()
            .into_iter()
            .map(|color| u8::from(color == Color::Dark))
            .collect(),
    })
}
