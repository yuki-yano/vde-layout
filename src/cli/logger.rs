#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

#[derive(Debug, Clone)]
pub struct CliLogger {
    level: LogLevel,
    prefix: String,
}

impl CliLogger {
    pub fn from_environment(verbose: bool) -> Self {
        let level = if verbose {
            LogLevel::Info
        } else if std::env::var("VDE_DEBUG").as_deref() == Ok("true") {
            LogLevel::Debug
        } else if std::env::var("VDE_VERBOSE").as_deref() == Ok("true") {
            LogLevel::Info
        } else {
            LogLevel::Warn
        };
        Self {
            level,
            prefix: String::new(),
        }
    }

    pub fn child(&self, suffix: impl AsRef<str>) -> Self {
        let suffix = suffix.as_ref();
        Self {
            level: self.level,
            prefix: if self.prefix.is_empty() {
                suffix.to_owned()
            } else {
                format!("{} {suffix}", self.prefix)
            },
        }
    }

    pub fn warn(&self, message: impl AsRef<str>) {
        if self.level >= LogLevel::Warn {
            eprintln!("{}", self.format(message.as_ref()));
        }
    }

    pub fn info(&self, message: impl AsRef<str>) {
        if self.level >= LogLevel::Info {
            println!("{}", self.format(message.as_ref()));
        }
    }

    pub fn debug(&self, message: impl AsRef<str>) {
        if self.level >= LogLevel::Debug {
            println!("{}", self.format(&format!("[DEBUG] {}", message.as_ref())));
        }
    }

    pub fn success(&self, message: impl AsRef<str>) {
        println!("{}", self.format(message.as_ref()));
    }

    fn format(&self, message: &str) -> String {
        if self.prefix.is_empty() {
            message.to_owned()
        } else {
            format!("{} {message}", self.prefix)
        }
    }
}
