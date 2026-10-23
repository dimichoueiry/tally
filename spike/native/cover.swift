// Clean-desktop cover for macOS. Puts a borderless, click-through window on every display at
// kCGDesktopIconWindowLevel + 20: above Finder's desktop icons, below every normal app window.
// Changes no system settings. Exits when stdin closes, so if the parent app dies the cover goes too.
//   cover [hex-color]        e.g. cover 1e1e2e
import AppKit

let hex = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "1e1e2e"
let v = UInt32(hex, radix: 16) ?? 0x1e1e2e
let color = NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                    blue: CGFloat(v & 0xff) / 255, alpha: 1)

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // no Dock icon, never takes focus

var windows: [NSWindow] = []
for screen in NSScreen.screens {
    let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    // +20: above icons (+0) and desktop widgets (+2, observed on macOS 27), far below normal windows (0)
    w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 20)
    w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    w.ignoresMouseEvents = true
    w.backgroundColor = color
    w.isReleasedWhenClosed = false
    w.orderFrontRegardless()
    windows.append(w)
}
print("COVER_UP level=\(windows.first?.level.rawValue ?? -1) windows=\(windows.count)")
fflush(stdout)

// Parent-death detection: stdin EOF (pipe closed by parent or by the OS when the parent dies).
DispatchQueue.global().async {
    while readLine() != nil {}
    DispatchQueue.main.async { exit(0) }
}
app.run()
