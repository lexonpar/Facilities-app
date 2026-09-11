import Foundation

enum AppConfig {
    static var webAppURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "WEB_APP_URL") as? String,
            !raw.isEmpty,
            let url = URL(string: raw)
        else {
            return URL(string: "https://on-par-checklists.vercel.app")!
        }
        return url
    }

    static var displayName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? "On Par Facilities"
    }
}
