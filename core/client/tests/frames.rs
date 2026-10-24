//! The placing rule of decision 0086 against the vectors the backend runs too
//! (`api/frames.vectors.json`): the two implementations cannot place a frame
//! differently.

use serde_json::Value;
use spjall_client::frames::{Focus, FrameRect, PixelRect, override_rect, place_frame};

const VECTORS: &str = include_str!("../../../api/frames.vectors.json");

fn vectors(group: &str) -> Vec<Value> {
    let all: Value = serde_json::from_str(VECTORS).expect("the vectors parse");
    let cases = all[group].as_array().expect("the group exists").clone();
    assert!(
        !cases.is_empty(),
        "no {group} vectors: the test would pass on nothing"
    );
    cases
}

fn int(v: &Value) -> u32 {
    u32::try_from(v.as_u64().expect("an integer")).expect("fits")
}

fn expected(case: &Value) -> PixelRect {
    let e = &case["expected"];
    PixelRect {
        x: int(&e["x"]),
        y: int(&e["y"]),
        w: int(&e["w"]),
        h: int(&e["h"]),
    }
}

#[test]
fn every_place_vector_matches() {
    for case in vectors("place") {
        let focus = Focus {
            x: case["focus"]["x"].as_f64().unwrap(),
            y: case["focus"]["y"].as_f64().unwrap(),
        };
        let got = place_frame(
            int(&case["imageW"]),
            int(&case["imageH"]),
            int(&case["aspectW"]),
            int(&case["aspectH"]),
            focus,
        );
        assert_eq!(got, expected(&case), "{}", case["name"]);
    }
}

#[test]
fn every_override_vector_matches() {
    for case in vectors("override") {
        let r = &case["rect"];
        let rect = FrameRect {
            x: r["x"].as_f64().unwrap(),
            y: r["y"].as_f64().unwrap(),
            w: r["w"].as_f64().unwrap(),
            h: r["h"].as_f64().unwrap(),
        };
        let got = override_rect(int(&case["imageW"]), int(&case["imageH"]), rect);
        assert_eq!(got, expected(&case), "{}", case["name"]);
    }
}
