//! Capped log files, and the server's own diagnostic lines. A desktop server owns `studio.log` and
//! writes its lines (and panics) there through a `LogWriter`, so it stays capped however long Studio
//! runs; any other server writes them to stderr. `owner.log` uses the same writer for Core's output.
use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

/// Each log keeps at most this many bytes, plus one older copy (`<name>.1`).
pub const LOG_CAP: u64 = 8 * 1024 * 1024;

/// An append-only log that keeps at most `LOG_CAP` bytes: a write that would pass the cap first moves the
/// file to `<name>.1`, replacing the older copy, and starts a new one. Only its owner writes the file.
pub struct LogWriter {
    path: PathBuf,
    file: Option<File>,
    len: u64,
    /// A start offset into this file, reset when the file is replaced.
    start: Arc<AtomicU64>,
    open: fn(&Path) -> std::io::Result<File>,
}

impl LogWriter {
    /// `open` opens the file for appending, with whatever protection the caller's platform needs.
    pub fn open(
        path: PathBuf,
        start: Arc<AtomicU64>,
        open: fn(&Path) -> std::io::Result<File>,
    ) -> std::io::Result<Self> {
        let mut file = open(&path)?;
        let mut len = file.metadata()?.len();
        if len > LOG_CAP {
            // A file from before the cap: keep its newest `LOG_CAP` bytes as the older copy, not all of it.
            drop(file);
            keep_tail(&path, open)?;
            file = open(&path)?;
            len = file.metadata()?.len();
        }
        Ok(Self {
            path,
            file: Some(file),
            len,
            start,
            open,
        })
    }

    /// Bytes in the current file.
    pub fn len(&self) -> u64 {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if self.len > 0 && self.len + bytes.len() as u64 > LOG_CAP {
            // Closed first: Windows doesn't rename an open file.
            self.file = None;
            rotate_log(&self.path)?;
            self.file = Some((self.open)(&self.path)?);
            self.len = 0;
            self.start.store(0, Ordering::SeqCst);
        }
        // A single write over the cap is cut, not kept whole.
        let kept = &bytes[..bytes.len().min(LOG_CAP as usize)];
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("log closed"))?;
        file.write_all(kept)?;
        self.len += kept.len() as u64;
        Ok(())
    }
}

/// `<name>` becomes `<name>.1`, replacing the older copy.
pub fn rotate_log(path: &Path) -> std::io::Result<()> {
    let mut older = path.as_os_str().to_owned();
    older.push(".1");
    std::fs::rename(path, older)
}

/// `<name>.1` becomes the last `LOG_CAP` bytes of `<name>`, which is then removed. The copy is opened
/// with `open`, so it gets the same protection as the log.
fn keep_tail(path: &Path, open: fn(&Path) -> std::io::Result<File>) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom};
    let mut older = path.as_os_str().to_owned();
    older.push(".1");
    let mut partial = older.clone();
    partial.push(".tmp");
    let mut source = File::open(path)?;
    source.seek(SeekFrom::End(-(LOG_CAP as i64)))?;
    let partial = PathBuf::from(partial);
    let _ = std::fs::remove_file(&partial);
    let mut tail = open(&partial)?;
    std::io::copy(&mut source, &mut tail)?;
    drop((source, tail));
    std::fs::rename(&partial, &older)?;
    std::fs::remove_file(path)
}

static SERVER_LOG: OnceLock<Mutex<LogWriter>> = OnceLock::new();

/// From now on this process's diagnostic lines and panics go to `log`. Once per process; a second call
/// is refused.
pub fn write_to(log: LogWriter) -> Result<(), String> {
    SERVER_LOG
        .set(Mutex::new(log))
        .map_err(|_| "the server log is already set".to_owned())?;
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        line(&format!("shellboy-studio: {info}"));
        previous(info);
    }));
    Ok(())
}

/// One diagnostic line: to the server's log once one is set, otherwise to stderr.
pub fn line(text: &str) {
    match SERVER_LOG.get() {
        Some(log) => {
            let mut bytes = text.as_bytes().to_vec();
            bytes.push(b'\n');
            // A log that can't be written has nowhere to report it.
            let _ = log.lock().unwrap_or_else(|p| p.into_inner()).write(&bytes);
        }
        None => eprintln!("{text}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn temp() -> Temp {
        let path =
            std::env::temp_dir().join(format!("studio-log-{}", crate::auth::random_hex().unwrap()));
        std::fs::create_dir(&path).unwrap();
        Temp(path)
    }
    fn append(path: &Path) -> std::io::Result<File> {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
    }

    #[test]
    fn a_log_keeps_one_older_copy_at_the_cap() {
        let dir = temp();
        let path = dir.0.join("owner.log");
        let older = dir.0.join("owner.log.1");
        let start = Arc::new(AtomicU64::new(0));
        let mut log = LogWriter::open(path.clone(), start.clone(), append).unwrap();
        let first = vec![b'a'; LOG_CAP as usize - 4];
        log.write(&first).unwrap();
        start.store(LOG_CAP - 4, Ordering::SeqCst);
        log.write(b"bbbbbbbb").unwrap();
        assert_eq!(std::fs::read(&older).unwrap(), first);
        assert_eq!(std::fs::read(&path).unwrap(), b"bbbbbbbb");
        assert_eq!(
            start.load(Ordering::SeqCst),
            0,
            "the start moves to the new file"
        );
        log.write(&vec![b'c'; LOG_CAP as usize]).unwrap();
        assert_eq!(
            std::fs::read(&older).unwrap(),
            b"bbbbbbbb",
            "only one older copy"
        );
        assert_eq!(std::fs::metadata(&path).unwrap().len(), LOG_CAP);
        drop(log);
        // A reopened log continues the same file and the same cap.
        let mut log = LogWriter::open(path.clone(), start, append).unwrap();
        log.write(b"d").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"d");
        assert_eq!(std::fs::metadata(&older).unwrap().len(), LOG_CAP);
    }

    #[test]
    fn a_log_from_before_the_cap_keeps_only_its_newest_part() {
        let dir = temp();
        let path = dir.0.join("studio.log");
        let mut old = vec![b'o'; LOG_CAP as usize + 100];
        old.extend_from_slice(b"newest");
        std::fs::write(&path, &old).unwrap();
        let mut log = LogWriter::open(path.clone(), Arc::default(), append).unwrap();
        let older = std::fs::read(dir.0.join("studio.log.1")).unwrap();
        assert_eq!(older.len() as u64, LOG_CAP);
        assert!(older.ends_with(b"newest"));
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);
        log.write(b"next\n").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"next\n");
    }

    /// The only test that sets this process's server log.
    #[test]
    fn server_lines_past_the_cap_rotate_during_the_run() {
        let dir = temp();
        let path = dir.0.join("studio.log");
        write_to(LogWriter::open(path.clone(), Arc::default(), append).unwrap()).unwrap();
        assert!(write_to(LogWriter::open(path.clone(), Arc::default(), append).unwrap()).is_err());
        let text = "x".repeat(1023);
        for _ in 0..LOG_CAP / 1024 {
            line(&text);
        }
        // Other tests in this process may add lines of their own, so sizes are bounds, not exact.
        assert!(std::fs::metadata(&path).unwrap().len() <= LOG_CAP);
        line("past the cap");
        let older = std::fs::metadata(dir.0.join("studio.log.1")).unwrap().len();
        assert!(older > 0 && older <= LOG_CAP);
        let current = std::fs::read_to_string(&path).unwrap();
        assert!(current.contains("past the cap\n"), "{}", current.len());
        assert!((current.len() as u64) < LOG_CAP / 2);
        // A panic's message lands in the log too.
        let _ = std::panic::catch_unwind(|| panic!("panic in the server"));
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("panic in the server")
        );
    }
}
