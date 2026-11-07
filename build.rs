//! Embeds the built frontend (`web/dist`, from `npm run build` in `web/`) into the binary. No
//! extra crate: a generated table of `include_bytes!`. Without a build the table is empty and
//! `GET /` says how to build it, so the bridge and its tests never need Node.
use std::{
    env,
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
};

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else {
            out.push(path);
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = root.join("web").join("dist");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", dist.display());
    let mut files = Vec::new();
    walk(&dist, &mut files);
    files.sort();
    let mut table = String::from("pub static EMBEDDED: &[(&str, &[u8])] = &[\n");
    for file in &files {
        println!("cargo:rerun-if-changed={}", file.display());
        let relative = file.strip_prefix(&dist).unwrap().to_string_lossy().replace('\\', "/");
        writeln!(table, "    ({relative:?}, include_bytes!({:?})),", file.display().to_string()).unwrap();
    }
    table.push_str("];\n");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("assets.rs");
    fs::write(out, table).unwrap();
}
