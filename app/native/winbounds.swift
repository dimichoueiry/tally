// Window bounds helper for Tally (macOS). Electron has no API for other apps' window
// frames, which window-mode bubble placement needs. CGWindowList bounds and owner
// names need no Screen Recording permission.
//
//   winbounds --watch <windowId>     JSON line on every change (polls 100 ms); exits on stdin EOF
//   winbounds --owners <id> <id>...  one JSON object: { "<id>": { "owner": "...", "pid": n } }
//   winbounds --list [pid,pid]       JSON array of on-screen app windows, front to back
import CoreGraphics
import Foundation

func info(_ id: CGWindowID) -> [String: Any]? {
  guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]], let w = list.first else { return nil }
  return w
}

func emit(_ obj: Any) {
  if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
    print(s)
    fflush(stdout)
  }
}

let args = Array(CommandLine.arguments.dropFirst())

// --list [pid,pid]: on-screen app windows (layer 0), front to back, for the window
// picker (SETUP_V2 §3.5). Transparent and tiny windows are skipped, as are the pids
// given (Tally itself, the cover helper).
if args.first == "--list" {
  let skip = Set((args.count > 1 ? args[1] : "").split(separator: ",").compactMap { Int($0) })
  let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
  var out: [[String: Any]] = []
  for w in list {
    guard (w[kCGWindowLayer as String] as? Int) == 0,
          let b = w[kCGWindowBounds as String] as? [String: Any],
          let width = b["Width"] as? Double, let height = b["Height"] as? Double, width >= 60, height >= 40,
          ((w[kCGWindowAlpha as String] as? Double) ?? 1) > 0.05 else { continue }
    let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
    if skip.contains(pid) { continue }
    out.append([
      "id": w[kCGWindowNumber as String] as? Int ?? 0, "pid": pid,
      "owner": w[kCGWindowOwnerName as String] as? String ?? "", "name": w[kCGWindowName as String] as? String ?? "",
      "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "width": width, "height": height,
    ])
  }
  emit(out)
  exit(0)
}
if args.first == "--owners" {
  var out: [String: Any] = [:]
  for a in args.dropFirst() {
    guard let id = UInt32(a), let w = info(id) else { continue }
    out[a] = ["owner": w[kCGWindowOwnerName as String] as? String ?? "", "pid": w[kCGWindowOwnerPID as String] as? Int ?? 0]
  }
  emit(out)
  exit(0)
}

guard args.first == "--watch", args.count > 1, let id = UInt32(args[1]) else {
  FileHandle.standardError.write("usage: winbounds --watch <id> | --owners <id>...\n".data(using: .utf8)!)
  exit(2)
}

// Exit when the parent closes our stdin (or dies).
DispatchQueue.global().async {
  while FileHandle.standardInput.availableData.count > 0 {}
  exit(0)
}

var last = ""
Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
  var obj: [String: Any] = ["id": Int(id)]
  if let w = info(id), let b = w[kCGWindowBounds as String] as? [String: Any] {
    obj["x"] = b["X"]; obj["y"] = b["Y"]; obj["width"] = b["Width"]; obj["height"] = b["Height"]
    obj["onscreen"] = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
  } else {
    obj["missing"] = true
  }
  let key = "\(obj)"
  if key != last { last = key; emit(obj) }
}
RunLoop.main.run()
