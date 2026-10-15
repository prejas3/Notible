//! CCS/1
//! M:media_import
//! PURPOSE:plugin API 1.28 `media.importImageFromUrl`: download one remote image into managed media
//! IO:(plugin's declared networkHosts, url) -> image bytes + extension; lib.rs stores them like pick_media_image
//! !SEC:every check lives here in Rust; the plugin id and url come from the shared JS realm and are untrusted
//! RULE:https only; host (and each redirect hop, max 3) must match networkHosts; no IP-literal hosts
//! RULE:all DNS answers must be public unicast; the connection is pinned to those checked addresses (no rebinding)
//! RULE:15 s for the whole chain; body streamed with a 20 MB cap; png/jpeg/webp/gif by magic bytes only
//! WHY:`fetch()` from plugin code can't be blocked (same realm), so `networkHosts` is only a disclosure there.
//! This call is different: Core does the request, so here the list is enforced.

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

pub const MAX_REDIRECTS: usize = 3;
pub const TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_BYTES: usize = 20 * 1024 * 1024;

/// What one request returned. `body` is empty for a redirect.
pub struct Hop {
    pub status: u16,
    pub location: Option<String>,
    pub body: Vec<u8>,
}

/// `example.org` matches only itself; `*.example.org` matches any subdomain, not the apex.
pub fn host_matches(host: &str, pattern: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let pattern = pattern.trim().to_ascii_lowercase();
    if !valid_host_pattern(&pattern) { return false; }
    match pattern.strip_prefix("*.") {
        Some(base) => host.len() > base.len() + 1 && host.ends_with(base) && host.as_bytes()[host.len() - base.len() - 1] == b'.',
        None => host == pattern,
    }
}

/// A DNS name, optionally behind `*.`: labels of a-z, 0-9 and `-`, at least one dot.
/// No scheme, port, path or IP literal, so a pattern can only ever name hosts.
pub fn valid_host_pattern(pattern: &str) -> bool {
    let name = pattern.strip_prefix("*.").unwrap_or(pattern);
    let labels: Vec<&str> = name.split('.').collect();
    name.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|label| !label.is_empty() && label.len() <= 63
            && !label.starts_with('-') && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
        && !labels.last().is_some_and(|tld| tld.bytes().all(|b| b.is_ascii_digit()))
}

/// The host of `url` if it may be requested at all: https, a DNS name (not an IP), allowed by `hosts`.
pub fn checked_host(url: &url::Url, hosts: &[String]) -> Result<String, String> {
    if url.scheme() != "https" { return Err(format!("only https:// images can be imported, not {}", url.scheme())); }
    if !url.username().is_empty() || url.password().is_some() { return Err("image URLs may not carry credentials".into()); }
    let host = match url.host() {
        Some(url::Host::Domain(domain)) => domain.trim_end_matches('.').to_ascii_lowercase(),
        Some(_) => return Err("image URLs must name a host, not an IP address".into()),
        None => return Err("image URL has no host".into()),
    };
    if !hosts.iter().any(|pattern| host_matches(&host, pattern)) {
        return Err(format!("{host} is not in this plugin's declared networkHosts"));
    }
    Ok(host)
}

/// Public unicast only. Refuses loopback, private, link-local, CGNAT, unique-local,
/// multicast, unspecified and documentation ranges, including IPv4 hidden in IPv6.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
                || v4.is_broadcast() || v4.is_multicast() || v4.is_documentation()
                || a == 0 || (a == 100 && (64..128).contains(&b)) || (a == 198 && (b == 18 || b == 19)) || a >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() { return is_public_ip(IpAddr::V4(v4)); }
            let first = v6.segments()[0];
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (first & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (first & 0xffc0) == 0xfec0 // old site-local
                || first == 0x2001 && v6.segments()[1] == 0x0db8 // documentation
                || first == 0x0064 && v6.segments()[1] == 0xff9b // NAT64 can reach private v4
                || first == 0 /* ::/16 incl. IPv4-compatible */)
        }
    }
}

/// The extension for an accepted image, from its first bytes only.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) { return Some("png"); }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) { return Some("jpg"); }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("gif"); }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" { return Some("webp"); }
    None
}

/// Append one received chunk, refusing to grow past `MAX_BYTES`.
pub fn push_capped(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if body.len() + chunk.len() > MAX_BYTES { return Err("image too large (max 20 MB)".into()); }
    body.extend_from_slice(chunk);
    Ok(())
}

/// Follow `url` through at most `MAX_REDIRECTS` redirects, checking every hop.
/// `resolve(host, remaining)` returns the host's addresses; `fetch(url, addrs, remaining)`
/// does one request pinned to those addresses. Both are injected so tests need no network.
/// `timeout` bounds the whole chain, DNS included (lib.rs passes `TIMEOUT`).
pub async fn import<R, RF, F, FF>(raw_url: &str, hosts: &[String], timeout: Duration, mut resolve: R, mut fetch: F) -> Result<(Vec<u8>, &'static str), String>
where
    R: FnMut(String, Duration) -> RF,
    RF: Future<Output = Result<Vec<IpAddr>, String>>,
    F: FnMut(url::Url, Vec<SocketAddr>, Duration) -> FF,
    FF: Future<Output = Result<Hop, String>>,
{
    let deadline = Instant::now() + timeout;
    let remaining = || deadline.checked_duration_since(Instant::now()).filter(|left| !left.is_zero())
        .ok_or_else(|| "image download timed out (15 s)".to_string());
    let mut url = url::Url::parse(raw_url.trim()).map_err(|error| format!("invalid image URL: {error}"))?;
    for hop in 0..=MAX_REDIRECTS {
        let host = checked_host(&url, hosts)?;
        let ips = resolve(host.clone(), remaining()?).await?;
        remaining()?; // a resolver that ignored its budget still can't stretch the chain
        if ips.is_empty() { return Err(format!("{host} did not resolve")); }
        if let Some(bad) = ips.iter().find(|ip| !is_public_ip(**ip)) {
            return Err(format!("{host} resolves to a non-public address ({bad})"));
        }
        let port = url.port_or_known_default().unwrap_or(443);
        let addrs = ips.into_iter().map(|ip| SocketAddr::new(ip, port)).collect();
        let response = fetch(url.clone(), addrs, remaining()?).await?;
        if matches!(response.status, 301 | 302 | 303 | 307 | 308) {
            if hop == MAX_REDIRECTS { return Err(format!("too many redirects (max {MAX_REDIRECTS})")); }
            let location = response.location.ok_or("redirect without a Location header")?;
            url = url.join(&location).map_err(|error| format!("invalid redirect target: {error}"))?;
            continue;
        }
        if !(200..300).contains(&response.status) { return Err(format!("image server answered HTTP {}", response.status)); }
        if response.body.len() > MAX_BYTES { return Err("image too large (max 20 MB)".into()); }
        let extension = sniff_image(&response.body).ok_or("the downloaded file is not a PNG, JPEG, WebP or GIF image")?;
        return Ok((response.body, extension));
    }
    unreachable!("the loop returns on its last hop")
}

/// The real transport: one HTTPS request with redirects off, DNS pinned to the checked `addrs`.
pub async fn fetch_hop(url: url::Url, addrs: Vec<SocketAddr>, remaining: Duration) -> Result<Hop, String> {
    let host = url.host_str().unwrap_or_default().to_string();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .resolve_to_addrs(&host, &addrs)
        .no_proxy() // a proxy would make the pinned addresses meaningless
        .timeout(remaining)
        .user_agent(concat!("Notible/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get(url).send().await.map_err(|error| format!("image download failed: {error}"))?;
    let status = response.status().as_u16();
    let location = response.headers().get(reqwest::header::LOCATION).and_then(|value| value.to_str().ok()).map(str::to_string);
    let mut body = Vec::new();
    if !(300..400).contains(&status) {
        if response.content_length().is_some_and(|length| length > MAX_BYTES as u64) { return Err("image too large (max 20 MB)".into()); }
        while let Some(chunk) = response.chunk().await.map_err(|error| format!("image download failed: {error}"))? {
            push_capped(&mut body, &chunk)?;
        }
    }
    Ok(Hop { status, location, body })
}

/// The real resolver. std's lookup blocks and can't be cancelled, so it runs on its own
/// thread and the caller stops waiting when `budget` runs out (the thread's late answer is dropped).
pub async fn resolve_host(host: String, budget: Duration) -> Result<Vec<IpAddr>, String> {
    bounded_blocking(budget, move || {
        use std::net::ToSocketAddrs;
        (host.as_str(), 443).to_socket_addrs().map(|addrs| addrs.map(|addr| addr.ip()).collect::<Vec<_>>())
            .map_err(|error| format!("could not resolve {host}: {error}"))
    }).await?
}

/// Run a blocking `job` and give up after `budget`. Without tokio's timer: the job gets its own
/// thread, and a blocking-pool task waits on its channel with `recv_timeout`.
pub async fn bounded_blocking<T: Send + 'static>(budget: Duration, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = sender.send(job()); });
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(budget)).await
        .map_err(|error| error.to_string())?
        .map_err(|_| "image download timed out (15 s)".to_string())
}

/// `networkHosts` of a stored manifest, only if it also declares `network` and `media.write`.
pub fn allowed_hosts(manifest: &serde_json::Value) -> Result<Vec<String>, String> {
    let permissions: Vec<&str> = manifest.get("permissions").and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|value| value.as_str()).collect()).unwrap_or_default();
    for needed in ["network", "media.write"] {
        if !permissions.contains(&needed) { return Err(format!("plugin lacks permission {needed}")); }
    }
    let hosts: Vec<String> = manifest.get("networkHosts").and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|value| value.as_str()).map(str::to_string).filter(|host| valid_host_pattern(host)).collect())
        .unwrap_or_default();
    if hosts.is_empty() { return Err("plugin declares no networkHosts".into()); }
    Ok(hosts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn hosts() -> Vec<String> { vec!["covers.openlibrary.org".into(), "*.archive.org".into()] }

    /// Mock network: url -> (status, location, body); every host resolves to `ip`.
    fn run(url: &str, ip: &str, routes: &[(&str, u16, Option<&str>, &[u8])]) -> (Result<(Vec<u8>, &'static str), String>, Vec<String>) {
        let routes: HashMap<String, Hop> = routes.iter().map(|(u, s, l, b)| (u.to_string(), Hop { status: *s, location: l.map(str::to_string), body: b.to_vec() })).collect();
        let routes = std::cell::RefCell::new(routes);
        let seen = std::cell::RefCell::new(Vec::new());
        let ip: IpAddr = ip.parse().unwrap();
        let result = tauri::async_runtime::block_on(import(url, &hosts(), TIMEOUT,
            |_host, _left| std::future::ready(Ok(vec![ip])),
            |url: url::Url, _addrs, _left| {
                seen.borrow_mut().push(url.to_string());
                std::future::ready(routes.borrow_mut().remove(url.as_str()).ok_or_else(|| format!("unexpected request {url}")))
            }));
        (result, seen.into_inner())
    }

    #[test]
    fn host_patterns() {
        assert!(host_matches("covers.openlibrary.org", "covers.openlibrary.org"));
        assert!(host_matches("ia800.us.archive.org", "*.archive.org"));
        assert!(!host_matches("archive.org", "*.archive.org"), "*. means a subdomain, not the apex");
        assert!(!host_matches("evilarchive.org", "*.archive.org"));
        assert!(!host_matches("openlibrary.org.evil.com", "openlibrary.org"));
        assert!(!valid_host_pattern("https://openlibrary.org") && !valid_host_pattern("openlibrary.org:443"));
        assert!(!valid_host_pattern("127.0.0.1") && !valid_host_pattern("*") && !valid_host_pattern("*.org"));
        assert!(!valid_host_pattern("localhost"));
    }

    #[test]
    fn ok_case_follows_an_allowed_redirect() {
        let (result, seen) = run("https://covers.openlibrary.org/b/id/1-L.jpg", "93.184.216.34", &[
            ("https://covers.openlibrary.org/b/id/1-L.jpg", 302, Some("https://ia800.us.archive.org/x.png"), b""),
            ("https://ia800.us.archive.org/x.png", 200, None, PNG),
        ]);
        let (bytes, extension) = result.unwrap();
        assert_eq!((bytes.as_slice(), extension), (PNG, "png"));
        assert_eq!(seen.len(), 2);
    }

    #[test]
    fn https_only() {
        let (result, seen) = run("http://covers.openlibrary.org/a.png", "93.184.216.34", &[]);
        assert!(result.unwrap_err().contains("only https"));
        assert!(seen.is_empty());
        let (result, _) = run("https://covers.openlibrary.org/a", "93.184.216.34", &[
            ("https://covers.openlibrary.org/a", 301, Some("http://covers.openlibrary.org/a.png"), b""),
        ]);
        assert!(result.unwrap_err().contains("only https"), "a redirect may not downgrade");
    }

    #[test]
    fn host_mismatch_including_redirect() {
        let (result, seen) = run("https://example.com/a.png", "93.184.216.34", &[]);
        assert!(result.unwrap_err().contains("not in this plugin's declared networkHosts"));
        assert!(seen.is_empty());
        let (result, seen) = run("https://covers.openlibrary.org/a", "93.184.216.34", &[
            ("https://covers.openlibrary.org/a", 302, Some("https://evil.example/a.png"), b""),
        ]);
        assert!(result.unwrap_err().contains("evil.example is not in"));
        assert_eq!(seen.len(), 1, "the undeclared hop is never requested");
        let (result, _) = run("https://93.184.216.34/a.png", "93.184.216.34", &[]);
        assert!(result.unwrap_err().contains("not an IP address"));
    }

    #[test]
    fn redirect_limit() {
        let hop = |n: u8| format!("https://covers.openlibrary.org/{n}");
        let urls: Vec<String> = (0..5).map(hop).collect();
        let routes: Vec<(&str, u16, Option<&str>, &[u8])> = (0..4).map(|n| (urls[n].as_str(), 302, Some(urls[n + 1].as_str()), b"" as &[u8])).collect();
        let (result, seen) = run(&urls[0], "93.184.216.34", &routes);
        assert!(result.unwrap_err().contains("too many redirects"));
        assert_eq!(seen.len(), 4, "the original request plus 3 redirects");
    }

    #[test]
    fn private_addresses_after_dns() {
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1", "64:ff9b::a00:1"] {
            let (result, seen) = run("https://covers.openlibrary.org/a.png", ip, &[]);
            assert!(result.unwrap_err().contains("non-public address"), "{ip} was allowed");
            assert!(seen.is_empty(), "{ip}: nothing may be requested");
        }
        assert!(is_public_ip("93.184.216.34".parse().unwrap()) && is_public_ip("2606:4700::1".parse().unwrap()));
    }

    #[test]
    fn dns_counts_against_the_deadline() {
        // A resolver that ignores its budget: the chain still stops before any request.
        let fetched = std::cell::Cell::new(false);
        let result = tauri::async_runtime::block_on(import("https://covers.openlibrary.org/a.png", &hosts(), Duration::from_millis(50),
            |_host, _left| { std::thread::sleep(Duration::from_millis(120)); std::future::ready(Ok(vec!["93.184.216.34".parse().unwrap()])) },
            |_url, _addrs, _left| { fetched.set(true); std::future::ready(Err("unreachable".to_string())) }));
        assert!(result.unwrap_err().contains("timed out"));
        assert!(!fetched.get(), "no request after the deadline");
        // The real resolver's mechanism: a hung lookup returns at the budget, not when it finishes.
        let started = Instant::now();
        let hung = tauri::async_runtime::block_on(bounded_blocking(Duration::from_millis(50), || std::thread::sleep(Duration::from_secs(3))));
        assert!(hung.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(1), "waited {:?}", started.elapsed());
    }

    #[test]
    fn size_cap() {
        let mut body = vec![0; MAX_BYTES - 1];
        assert!(push_capped(&mut body, &[1]).is_ok());
        assert!(push_capped(&mut body, &[1]).unwrap_err().contains("too large"));
        let big = vec![0x89; MAX_BYTES + 1];
        let (result, _) = run("https://covers.openlibrary.org/a.png", "93.184.216.34", &[("https://covers.openlibrary.org/a.png", 200, None, &big)]);
        assert!(result.unwrap_err().contains("too large"));
    }

    #[test]
    fn non_image_bytes_and_http_errors() {
        let (result, _) = run("https://covers.openlibrary.org/a.png", "93.184.216.34", &[("https://covers.openlibrary.org/a.png", 200, None, b"<svg xmlns='http://www.w3.org/2000/svg'/>")]);
        assert!(result.unwrap_err().contains("not a PNG"));
        let (result, _) = run("https://covers.openlibrary.org/a.png", "93.184.216.34", &[("https://covers.openlibrary.org/a.png", 404, None, b"")]);
        assert!(result.unwrap_err().contains("HTTP 404"));
        assert_eq!(sniff_image(b"BM......"), None, "bmp is not accepted from the network");
    }

    #[test]
    fn manifest_needs_both_permissions_and_hosts() {
        let manifest = |value: serde_json::Value| allowed_hosts(&value);
        assert!(manifest(serde_json::json!({ "permissions": ["media.write"], "networkHosts": ["a.org"] })).unwrap_err().contains("network"));
        assert!(manifest(serde_json::json!({ "permissions": ["network"], "networkHosts": ["a.org"] })).unwrap_err().contains("media.write"));
        assert!(manifest(serde_json::json!({ "permissions": ["network", "media.write"] })).unwrap_err().contains("no networkHosts"));
        assert_eq!(manifest(serde_json::json!({ "permissions": ["network", "media.write"], "networkHosts": ["a.org", "http://b.org"] })).unwrap(), vec!["a.org"]);
    }
}
