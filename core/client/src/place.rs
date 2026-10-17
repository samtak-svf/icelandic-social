//! A sent location (0059): the links that open it and the numbers the apps
//! draw. Built here once, so both apps open the same place, and a change on
//! map.is is one change. Nothing here fetches anything.

/// What the apps need to draw a location and open it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaceLinks {
    /// map.is at a pin on the place; none outside ISN93's area, where
    /// map.is has nothing to show.
    pub map_is: Option<String>,
    /// A `geo:` URI, which Android hands to the map app the person chose.
    pub geo: String,
    /// An Apple Maps link, which iOS opens in its maps app.
    pub apple_maps: String,
    /// The point as every map app and search field accepts it:
    /// `64.141960, -21.926570`.
    pub copy: String,
    /// The latitude's distance from the equator in degrees, to 5 places with
    /// the Icelandic decimal comma (`64,14196`); `north` says which side.
    pub latitude: String,
    pub north: bool,
    /// The longitude's distance from Greenwich, as `latitude`; `east` says
    /// which side.
    pub longitude: String,
    pub east: bool,
}

/// How close map.is opens. Its views halve the metres per pixel at each
/// step from 4096; at 12 a pixel is a metre, so a phone shows the streets
/// around the pin.
const MAP_IS_ZOOM: u32 = 12;

/// The links and numbers for a point given in WGS 84 microdegrees, which
/// the caller has checked with `spjall_envelope::is_place`.
pub fn links(lat_e6: i32, lon_e6: i32) -> PlaceLinks {
    let (lat, lon) = (decimal(lat_e6, 6, '.'), decimal(lon_e6, 6, '.'));
    let point = format!("{lat},{lon}");
    PlaceLinks {
        map_is: isn93(lat_e6, lon_e6).map(|(east, north)| {
            // map.is calls them lon and lat, and reads ISN93 metres
            // (EPSG:3057): its own page code, read on 2026-10-17 (0059).
            format!("https://map.is/?action=pin%7Blon:{east},lat:{north},zoom:{MAP_IS_ZOOM}%7D")
        }),
        geo: format!("geo:{point}?q={point}"),
        apple_maps: format!("https://maps.apple.com/?ll={point}&q={point}"),
        copy: format!("{lat}, {lon}"),
        latitude: decimal(lat_e6.unsigned_abs() as i64, 5, ','),
        north: lat_e6 >= 0,
        longitude: decimal(lon_e6.unsigned_abs() as i64, 5, ','),
        east: lon_e6 >= 0,
    }
}

/// `value` millionths written with `places` decimals (5 or 6), rounded
/// half away from zero, from the integer so no float decides a digit.
fn decimal(value: impl Into<i64>, places: u32, separator: char) -> String {
    let value: i64 = value.into();
    let scale = 10_i64.pow(6 - places);
    let rounded = (value.abs() + scale / 2) / scale;
    let unit = 10_i64.pow(places);
    let sign = if value < 0 && rounded != 0 { "-" } else { "" };
    format!(
        "{sign}{}{separator}{:0width$}",
        rounded / unit,
        rounded % unit,
        width = places as usize
    )
}

/// ISN93's area of use (EPSG:3057): Iceland, its waters and Jan Mayen's
/// south, in degrees.
const ISN93_AREA: (f64, f64, f64, f64) = (59.96, 69.59, -30.87, -5.55);

/// The point in ISN93 (EPSG:3057), easting and northing in whole metres:
/// Lambert conformal conic with two standard parallels on GRS 80, as the
/// National Land Survey defines it. None outside its area of use.
fn isn93(lat_e6: i32, lon_e6: i32) -> Option<(i64, i64)> {
    let (lat, lon) = (f64::from(lat_e6) / 1e6, f64::from(lon_e6) / 1e6);
    let (south, north, west, east) = ISN93_AREA;
    if !(south..=north).contains(&lat) || !(west..=east).contains(&lon) {
        return None;
    }
    const A: f64 = 6_378_137.0;
    const F: f64 = 1.0 / 298.257_222_101;
    let e = (2.0 * F - F * F).sqrt();
    let [phi1, phi2, phi0, lambda0] = [64.25_f64, 65.75, 65.0, -19.0].map(f64::to_radians);
    let m = |phi: f64| phi.cos() / (1.0 - (e * phi.sin()).powi(2)).sqrt();
    let t = |phi: f64| {
        (std::f64::consts::FRAC_PI_4 - phi / 2.0).tan()
            / ((1.0 - e * phi.sin()) / (1.0 + e * phi.sin())).powf(e / 2.0)
    };
    let n = (m(phi1).ln() - m(phi2).ln()) / (t(phi1).ln() - t(phi2).ln());
    let big_f = m(phi1) / (n * t(phi1).powf(n));
    let rho = |phi: f64| A * big_f * t(phi).powf(n);
    let theta = n * (lon.to_radians() - lambda0);
    let easting = 500_000.0 + rho(lat.to_radians()) * theta.sin();
    let northing = 500_000.0 + rho(phi0) - rho(lat.to_radians()) * theta.cos();
    Some((easting.round() as i64, northing.round() as i64))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hallgrímskirkja, and two points far apart in Iceland, against PROJ
    /// (`cs2cs EPSG:4326 EPSG:3057`): 357571.960 407642.435,
    /// 722396.370 676060.048 and 225384.470 333577.240.
    #[test]
    fn isn93_matches_proj() {
        assert_eq!(isn93(64_141_960, -21_926_570), Some((357_572, 407_642)));
        assert_eq!(isn93(66_500_000, -14_000_000), Some((722_396, 676_060)));
        assert_eq!(isn93(63_400_000, -24_500_000), Some((225_384, 333_577)));
    }

    /// The pin at Hallgrímskirkja was opened in a browser on 2026-10-17 and
    /// lands on the church.
    #[test]
    fn map_is_opens_a_pin_in_isn93_metres() {
        assert_eq!(
            links(64_141_960, -21_926_570).map_is.as_deref(),
            Some("https://map.is/?action=pin%7Blon:357572,lat:407642,zoom:12%7D")
        );
    }

    /// Outside Iceland map.is has nothing to show; the map app still opens.
    #[test]
    fn outside_isn93_there_is_no_map_is_link() {
        let copenhagen = links(55_676_100, 12_568_300);
        assert_eq!(copenhagen.map_is, None);
        assert_eq!(
            copenhagen.geo,
            "geo:55.676100,12.568300?q=55.676100,12.568300"
        );
    }

    #[test]
    fn the_apps_get_every_link_and_number() {
        assert_eq!(
            links(64_141_960, -21_926_570),
            PlaceLinks {
                map_is: Some(
                    "https://map.is/?action=pin%7Blon:357572,lat:407642,zoom:12%7D".into()
                ),
                geo: "geo:64.141960,-21.926570?q=64.141960,-21.926570".into(),
                apple_maps:
                    "https://maps.apple.com/?ll=64.141960,-21.926570&q=64.141960,-21.926570".into(),
                copy: "64.141960, -21.926570".into(),
                latitude: "64,14196".into(),
                north: true,
                longitude: "21,92657".into(),
                east: false,
            }
        );
    }

    /// Digits come from the integer: rounding is half away from zero, a
    /// small negative keeps its sign only when a digit is left, and the
    /// extremes do not overflow.
    #[test]
    fn decimals_are_exact() {
        assert_eq!(decimal(64_141_965, 5, ','), "64,14197");
        assert_eq!(decimal(-21_926_575, 5, ','), "-21,92658");
        assert_eq!(decimal(-4, 5, ','), "0,00000");
        assert_eq!(decimal(-5, 6, '.'), "-0.000005");
        assert_eq!(decimal(180_000_000, 6, '.'), "180.000000");
        assert_eq!(decimal(i64::from(i32::MIN), 6, '.'), "-2147.483648");
        let south_west = links(-33_856_800, -151_215_300);
        assert_eq!((south_west.north, south_west.east), (false, false));
        assert_eq!(south_west.latitude, "33,85680");
        assert_eq!(south_west.longitude, "151,21530");
    }
}
