// Clean-desktop cover (macOS). Puts a borderless, click-through window on one display at
// kCGDesktopIconWindowLevel + 20: above Finder's desktop icons and widgets, below every
// normal app window. Changes no system settings. Exits when stdin closes, so if Tally
// dies the cover goes too (ARCHITECTURE §6.1, spike/native/cover.swift).
//
//   cover --display <CGDirectDisplayID|all> --color 1d2420
//   cover --display <id> --wallpaper            draws that display's current wallpaper
//   cover --display <id> --image /path.jpg      draws an image the user chose
//   cover --display <id> --glow 2d4a41,111615   soft radial light over a dark base
//   cover --thumb <id> [width]                  prints the wallpaper as a small JPEG data URL, then exits
//   cover --fill <id> <width> [cover options]   prints what the cover looks like (privacy strips), then exits
//
// The wallpaper is read and drawn in this process only; it is never copied anywhere.
import AppKit

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}
let has = { (name: String) in CommandLine.arguments.contains(name) }

func screenFor(_ id: String?) -> [NSScreen] {
    guard let id = id, id != "all", let n = UInt32(id) else { return NSScreen.screens }
    let match = NSScreen.screens.filter { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == n }
    return match.isEmpty ? [NSScreen.main ?? NSScreen.screens[0]] : match
}

func color(_ hex: String) -> NSColor {
    let v = UInt32(hex.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0x1d2420
    return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

func wallpaper(_ screen: NSScreen) -> NSImage? {
    guard let url = NSWorkspace.shared.desktopImageURL(for: screen) else { return nil }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else { return nil }
    guard let img = NSImage(contentsOf: url), img.isValid, img.size.width > 0 else { return nil }
    return img
}

// --thumb: a small preview for the launcher's "Current wallpaper" swatch (stdout only).
if let id = arg("--thumb") {
    let width = CGFloat(Double(CommandLine.arguments.last ?? "") ?? 96)
    guard let screen = screenFor(id).first, let img = wallpaper(screen) else { print("NONE"); exit(0) }
    let h = (width * img.size.height / img.size.width).rounded()
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width), pixelsHigh: Int(h), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    img.draw(in: NSRect(x: 0, y: 0, width: width, height: h))
    NSGraphicsContext.restoreGraphicsState()
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!
    print("data:image/jpeg;base64," + data.base64EncodedString())
    exit(0)
}

// --fill: what the cover looks like on that display (same options as the cover), as a
// JPEG data URL at <width> px, for the engine to paint over the menu-bar / Dock strips
// of each frame (privacy levels). First line: SAFE_TOP <pt> (the notch's height, or 0).
if let id = arg("--fill") {
    guard let screen = screenFor(id).first else { print("NONE"); exit(0) }
    let a = CommandLine.arguments
    let width = CGFloat(Double(a[(a.firstIndex(of: "--fill") ?? 0) + 2]) ?? 1920)
    let size = screen.frame.size
    let w = Int(width), h = Int((width * size.height / size.width).rounded())
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let gc = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = gc
    let full = NSRect(x: 0, y: 0, width: w, height: h)
    color(arg("--color") ?? "1d2420").setFill()
    full.fill()
    var img: NSImage? = nil
    if has("--wallpaper") { img = wallpaper(screen) }
    if let path = arg("--image") { img = NSImage(contentsOfFile: path) }
    if let img = img, img.size.width > 0, img.size.height > 0 {
        // Aspect fill, centred: what the cover window's layer does (.resizeAspectFill).
        let s = max(CGFloat(w) / img.size.width, CGFloat(h) / img.size.height)
        let iw = img.size.width * s, ih = img.size.height * s
        img.draw(in: NSRect(x: (CGFloat(w) - iw) / 2, y: (CGFloat(h) - ih) / 2, width: iw, height: ih))
    } else if let g = arg("--glow") {
        let parts = g.split(separator: ",").map(String.init)
        let grad = CAGradientLayer()
        grad.frame = CGRect(x: 0, y: 0, width: w, height: h)
        grad.type = .radial
        grad.colors = [color(parts.first ?? "2d4a41").cgColor, color(parts.count > 1 ? parts[1] : "111615").cgColor]
        grad.startPoint = CGPoint(x: 0.75, y: 0.9)
        grad.endPoint = CGPoint(x: 1.6, y: -0.2)
        grad.render(in: gc.cgContext)
    }
    NSGraphicsContext.restoreGraphicsState()
    let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])!
    print("SAFE_TOP \(screen.safeAreaInsets.top)")
    print("data:image/jpeg;base64," + data.base64EncodedString())
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // no Dock icon, never takes focus

var windows: [NSWindow] = []
var mode = "color"
for screen in screenFor(arg("--display")) {
    let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    // +20: above icons (+0) and desktop widgets (+2, observed on macOS 27), far below normal windows (0)
    w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 20)
    w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    w.ignoresMouseEvents = true // clicks fall through to the desktop / apps
    w.isReleasedWhenClosed = false
    w.hasShadow = false
    w.backgroundColor = color(arg("--color") ?? "1d2420")
    var img: NSImage? = nil
    if has("--wallpaper") { img = wallpaper(screen) }
    if let path = arg("--image") { img = NSImage(contentsOfFile: path) }
    if let img = img {
        let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        view.wantsLayer = true
        view.layer?.contents = img
        view.layer?.contentsGravity = .resizeAspectFill
        w.contentView = view
        mode = has("--wallpaper") ? "wallpaper" : "image"
    } else if let g = arg("--glow") {
        // Glow (SETUP_V2 §3.3): a soft light top-right over the base colour, like the mockup.
        let parts = g.split(separator: ",").map(String.init)
        let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        view.wantsLayer = true
        let grad = CAGradientLayer()
        grad.frame = view.bounds
        grad.type = .radial
        grad.colors = [color(parts.first ?? "2d4a41").cgColor, color(parts.count > 1 ? parts[1] : "111615").cgColor]
        grad.startPoint = CGPoint(x: 0.75, y: 0.9) // layer coordinates: y up
        grad.endPoint = CGPoint(x: 1.6, y: -0.2)
        view.layer?.addSublayer(grad)
        w.contentView = view
        mode = "glow"
    } else if has("--wallpaper") || arg("--image") != nil {
        mode = "fallback"
    }
    w.orderFrontRegardless()
    windows.append(w)
}
print("COVER_UP level=\(windows.first?.level.rawValue ?? -1) windows=\(windows.count) mode=\(mode)")
fflush(stdout)

// Parent-death detection: stdin EOF (pipe closed by Tally or by the OS when it dies).
DispatchQueue.global().async {
    while readLine() != nil {}
    DispatchQueue.main.async { exit(0) }
}
app.run()
