//! The native peer `tests/interop.mjs` runs between the browser side's
//! steps, as account `a` device `d1`. Its store and a `state` file (the
//! device key, then the group id, in hex) stay in `dir` between runs.
//!
//!   native invite <dir> <key-package-file> <welcome-out>
//!   native receive <dir> <message-file>          prints "<sender>\t<text>"
//!   native send <dir> <text> <message-out>

#[cfg(not(target_arch = "wasm32"))]
fn main() -> Result<(), spjall_web_spike::Error> {
    use spjall_web_spike::Peer;
    use std::fs;
    use std::path::Path;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
            .collect()
    }

    let args: Vec<String> = std::env::args().collect();
    let dir = Path::new(&args[2]);
    let state = dir.join("state");
    let mut peer = if args[1] == "invite" {
        Peer::create(dir, "a", "d1")?
    } else {
        let text = fs::read_to_string(&state)?;
        let mut lines = text.lines();
        let public_key = unhex(lines.next().ok_or("no key")?);
        let group = lines.next().map(unhex);
        Peer::open(dir, "a", "d1", public_key, group)?
    };
    match args[1].as_str() {
        "invite" => {
            assert!(
                peer.store_is_encrypted()?,
                "the native store must be SQLCipher"
            );
            let welcome = peer.invite("b", "d2", fs::read(&args[3])?)?;
            fs::write(&args[4], welcome)?;
        }
        "receive" => {
            let (sender, text) = peer.receive(&fs::read(&args[3])?)?;
            println!("{sender}\t{text}");
        }
        "send" => fs::write(&args[4], peer.send("n1", 1, &args[3])?)?,
        other => return Err(format!("unknown command {other}").into()),
    }
    let group = peer.group().map(hex).unwrap_or_default();
    fs::write(&state, format!("{}\n{group}\n", hex(peer.public_key())))?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {}
