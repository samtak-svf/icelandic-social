//! Threads opening a process's first databases at once were refused, and once
//! crashed (#81). Only the first round in a process showed it, so this file holds
//! one test and the binary runs it alone. It fails rarely when the lock is gone:
//! 4 of 1,800 runs, so one green run proves nothing.

use std::sync::{Arc, Barrier};

#[test]
fn threads_can_open_their_first_databases_at_once() {
    const THREADS: usize = 8;
    let dir = tempfile::tempdir().unwrap();
    let barrier = Arc::new(Barrier::new(THREADS));
    let openers: Vec<_> = (0..THREADS)
        .map(|n| {
            let barrier = Arc::clone(&barrier);
            let path = dir.path().join(format!("{n}.db"));
            std::thread::spawn(move || {
                barrier.wait();
                spjall_store::connect(&path, &[7; 32]).map(|_| ())
            })
        })
        .collect();
    for opener in openers {
        opener.join().unwrap().unwrap();
    }
}
