use androidqa_core::{ProcessAdb, list_devices};
use anyhow::Result;

fn main() -> Result<()> {
    let adb = ProcessAdb::discover()?;
    let devices = list_devices(&adb)?;
    println!("{}", serde_json::to_string_pretty(&devices)?);
    Ok(())
}
