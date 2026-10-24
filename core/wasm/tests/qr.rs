//! The link code as a matrix the page draws.
use spjall_wasm::qr::link_qr;

#[test]
fn a_code_becomes_a_square_matrix_of_zeros_and_ones() {
    let qr = link_qr("spjall-link:abc").expect("encode");
    assert!(qr.size >= 21, "version 1 is 21 modules a side");
    assert_eq!(qr.modules.len(), qr.size * qr.size);
    assert!(qr.modules.iter().all(|m| *m <= 1));
    assert!(qr.modules.contains(&1) && qr.modules.contains(&0));
}

#[test]
fn the_finder_pattern_sits_in_three_corners() {
    let qr = link_qr("x").expect("encode");
    let at = |row: usize, col: usize| qr.modules[row * qr.size + col];
    for (row, col) in [(0, 0), (0, qr.size - 7), (qr.size - 7, 0)] {
        // The 7x7 finder: a dark ring, a light ring, a dark 3x3 centre.
        assert_eq!(at(row, col), 1);
        assert_eq!(at(row + 1, col + 1), 0);
        assert_eq!(at(row + 3, col + 3), 1);
    }
}

#[test]
fn the_same_code_gives_the_same_matrix() {
    assert_eq!(link_qr("same").unwrap(), link_qr("same").unwrap());
}

#[test]
fn a_longer_code_needs_a_bigger_matrix() {
    let short = link_qr("a").unwrap();
    let long = link_qr(&"a".repeat(200)).unwrap();
    assert!(long.size > short.size);
}

#[test]
fn text_too_long_for_any_version_is_an_error_not_a_panic() {
    assert!(link_qr(&"a".repeat(10_000)).is_err());
}
