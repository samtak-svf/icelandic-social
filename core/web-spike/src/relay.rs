//! An in-memory stand-in for the server, enough for two `spjall-client`
//! devices to make a conversation and exchange messages and media. The
//! browser's worker suite and the native peer's history export share it.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use spjall_client::api::{Method, Request, Response, Transport, Unreachable};
use spjall_client::{BlobStore, MemBlobs};

#[derive(Default)]
pub struct MiniRelay {
    packages: BTreeMap<String, Vec<(String, String)>>,
    welcomes: BTreeMap<(String, String), String>,
    messages: BTreeMap<String, Vec<serde_json::Value>>,
    media: BTreeMap<String, Vec<u8>>,
    photos: BTreeMap<String, Vec<u8>>,
    social_media: BTreeMap<String, Vec<u8>>,
}

#[derive(Clone)]
pub struct WorkerTransport {
    pub account: String,
    pub device: String,
    pub blobs: MemBlobs,
    pub relay: Arc<Mutex<MiniRelay>>,
}

impl Transport for WorkerTransport {
    fn request(&self, req: Request) -> Result<Response, Unreachable> {
        let mut r = self.relay.lock().unwrap();
        let body: serde_json::Value = req
            .body
            .as_deref()
            .and_then(|b| serde_json::from_str(b).ok())
            .unwrap_or(serde_json::Value::Null);
        match (req.method, req.path.as_str()) {
            (Method::Post, "/v1/key-packages") => {
                let list = r.packages.entry(self.account.clone()).or_default();
                if let Some(arr) = body["keyPackages"].as_array() {
                    for kp in arr {
                        if let Some(s) = kp.as_str() {
                            list.push((self.device.clone(), s.to_owned()));
                        }
                    }
                }
                if let Some(lr) = body["lastResort"].as_str()
                    && list.is_empty()
                {
                    list.push((self.device.clone(), lr.to_owned()));
                }
                Ok(Response {
                    status: 200,
                    body: serde_json::json!({
                        "available": list.len(),
                        "lastResortNotAfter": 4_102_444_800_000u64
                    })
                    .to_string(),
                })
            }
            (Method::Post, p) if p.starts_with("/v1/accounts/") && p.ends_with("/key-packages") => {
                let target = p
                    .trim_start_matches("/v1/accounts/")
                    .trim_end_matches("/key-packages");
                let claimed: Vec<_> = r
                    .packages
                    .get_mut(target)
                    .and_then(|list| list.pop())
                    .into_iter()
                    .map(|(device_id, key_package)| {
                        serde_json::json!({ "deviceId": device_id, "keyPackage": key_package })
                    })
                    .collect();
                Ok(Response {
                    status: 200,
                    body: serde_json::json!({ "keyPackages": claimed }).to_string(),
                })
            }
            (Method::Post, "/v1/conversations") => Ok(Response {
                status: 200,
                body: "{}".into(),
            }),
            (Method::Post, p)
                if p.starts_with("/v1/conversations/") && p.ends_with("/messages") =>
            {
                let conv = p
                    .trim_start_matches("/v1/conversations/")
                    .trim_end_matches("/messages");
                let seq = {
                    let list = r.messages.entry(conv.to_owned()).or_default();
                    let seq = (list.len() + 1) as u64;
                    list.push(serde_json::json!({
                        "seq": seq,
                        "ciphertext": body["ciphertext"],
                        "storedAt": 1_700_000_000_000u64 + seq
                    }));
                    seq
                };
                if let Some(welcome) = body["welcome"]["message"].as_str() {
                    r.welcomes.insert(
                        (conv.to_owned(), "a_bob/d_2".to_owned()),
                        serde_json::json!({ "seq": seq, "welcome": welcome }).to_string(),
                    );
                }
                Ok(Response {
                    status: 200,
                    body: serde_json::json!({ "seq": seq }).to_string(),
                })
            }
            (Method::Get, p) if p.starts_with("/v1/conversations/") && p.contains("/messages") => {
                let (conv, query) = p
                    .trim_start_matches("/v1/conversations/")
                    .split_once("/messages")
                    .unwrap();
                let after: u64 = query
                    .trim_start_matches("?after=")
                    .split('&')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let msgs: Vec<_> = r
                    .messages
                    .get(conv)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|m| m["seq"].as_u64().unwrap_or(0) > after)
                    .collect();
                Ok(Response {
                    status: 200,
                    body: serde_json::json!({ "messages": msgs, "more": false }).to_string(),
                })
            }
            (Method::Get, p) if p.starts_with("/v1/conversations/") && p.ends_with("/welcome") => {
                let conv = p
                    .trim_start_matches("/v1/conversations/")
                    .trim_end_matches("/welcome");
                let key = (conv.to_owned(), format!("{}/{}", self.account, self.device));
                match r.welcomes.get(&key) {
                    Some(w) => Ok(Response {
                        status: 200,
                        body: w.clone(),
                    }),
                    None => Ok(Response {
                        status: 404,
                        body: serde_json::json!({ "error": "not_found" }).to_string(),
                    }),
                }
            }
            (Method::Get, p) if p.starts_with("/v1/conversations/") && p.ends_with("/devices") => {
                Ok(Response {
                    status: 200,
                    body: serde_json::json!({
                        "accounts": [
                            { "accountId": "a_alice", "deviceIds": ["d_1"] },
                            { "accountId": "a_bob", "deviceIds": ["d_2"] }
                        ]
                    })
                    .to_string(),
                })
            }
            (Method::Get, "/v1/me") => Ok(Response {
                status: 200,
                body: serde_json::json!({
                    "accountId": self.account,
                    "name": "Vafri",
                    "verified": true,
                    "photo": "ph_v1",
                    "devices": [{
                        "deviceId": self.device,
                        "platform": "android",
                        "createdAt": 1_700_000_000_000u64,
                        "current": true
                    }]
                })
                .to_string(),
            }),
            (Method::Get, p) if p.starts_with("/v1/accounts/") => Ok(Response {
                status: 200,
                body: serde_json::json!({
                    "name": "Félagi",
                    "verified": true,
                    "photo": "ph_v1"
                })
                .to_string(),
            }),
            (Method::Get, "/v1/blocks") => Ok(Response {
                status: 200,
                body: serde_json::json!({ "blocked": [] }).to_string(),
            }),
            (Method::Get, "/v1/mutes") => Ok(Response {
                status: 200,
                body: serde_json::json!({ "muted": [] }).to_string(),
            }),
            (Method::Delete, p) if p.starts_with("/v1/devices/") => Ok(Response {
                status: 204,
                body: String::new(),
            }),
            _ => Err(Unreachable(format!(
                "unhandled {:?} {}",
                req.method, req.path
            ))),
        }
    }

    fn upload(&self, req: Request, file: &Path) -> Result<Response, Unreachable> {
        let mut reader = self
            .blobs
            .open_read(file)
            .map_err(|e| Unreachable(e.to_string()))?;
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(|e| Unreachable(e.to_string()))?;
        let mut r = self.relay.lock().unwrap();
        if req.path == "/v1/me/photo" {
            r.photos.insert(self.account.clone(), bytes);
            return Ok(Response {
                status: 200,
                body: serde_json::json!({ "photo": "ph_v1" }).to_string(),
            });
        }
        if req.path.ends_with("/media") && req.path.starts_with("/v1/communities/") {
            r.social_media.insert("m_1".into(), bytes);
            return Ok(Response {
                status: 200,
                body: serde_json::json!({
                    "mediaId": "m_1",
                    "width": 64,
                    "height": 64
                })
                .to_string(),
            });
        }
        r.media.insert(req.path, bytes);
        Ok(Response {
            status: 204,
            body: String::new(),
        })
    }

    fn download(&self, req: Request, to: &Path) -> Result<Response, Unreachable> {
        let r = self.relay.lock().unwrap();
        let bytes = if req.path.ends_with("/photo") {
            let acct = req
                .path
                .trim_start_matches("/v1/accounts/")
                .trim_end_matches("/photo");
            r.photos.get(acct).cloned()
        } else if req.path.starts_with("/v1/posts/") {
            r.social_media.get("m_1").cloned()
        } else {
            r.media.get(&req.path).cloned()
        };
        let Some(bytes) = bytes else {
            return Ok(Response {
                status: 404,
                body: serde_json::json!({ "error": "not_found" }).to_string(),
            });
        };
        drop(r);
        let mut writer = self
            .blobs
            .create_write(to)
            .map_err(|e| Unreachable(e.to_string()))?;
        writer
            .write_all(&bytes)
            .map_err(|e| Unreachable(e.to_string()))?;
        writer.finish().map_err(|e| Unreachable(e.to_string()))?;
        Ok(Response {
            status: 200,
            body: String::new(),
        })
    }
}
