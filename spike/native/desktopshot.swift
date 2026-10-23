// Spike-only verifier. Screenshots ONLY windows below the normal window layer (wallpaper, desktop
// icons, the cover) with ScreenCaptureKit, and lists their layers.  desktopshot <out.png>
import AppKit
import ScreenCaptureKit

let out = CommandLine.arguments[1]
let sem = DispatchSemaphore(value: 0)
Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let display = content.displays[0]
        let below = content.windows.filter { $0.windowLayer < 0 }
        for w in below {
            print("layer=\(w.windowLayer) app=\(w.owningApplication?.bundleIdentifier ?? "-") title=\(w.title ?? "")")
        }
        let filter = SCContentFilter(display: display, including: below)
        let cfg = SCStreamConfiguration()
        cfg.width = display.width
        cfg.height = display.height
        let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        let rep = NSBitmapImageRep(cgImage: img)
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
        print("SAVED \(out) \(img.width)x\(img.height) normalWindowLevel=\(CGWindowLevelForKey(.normalWindow)) iconLevel=\(CGWindowLevelForKey(.desktopIconWindow))")
    } catch { print("ERROR \(error)") }
    sem.signal()
}
sem.wait()
