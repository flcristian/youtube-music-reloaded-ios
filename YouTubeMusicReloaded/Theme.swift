import SwiftUI

/// YouTube Music's desktop colors.
enum Theme {
    static let background = Color(red: 3 / 255, green: 3 / 255, blue: 3 / 255)
    static let surface = Color(red: 33 / 255, green: 33 / 255, blue: 33 / 255)
    static let field = Color.white.opacity(0.1)
    static let primaryText = Color.white
    static let secondaryText = Color.white.opacity(0.7)
    static let divider = Color.white.opacity(0.1)
    static let accent = Color(red: 1, green: 0, blue: 51 / 255)
}

/// A square cover from a URL, gray while it loads.
struct Cover: View {
    let url: String?
    var size: CGFloat
    var corner: CGFloat = 2

    var body: some View {
        RemoteImage(url: url)
            .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner))
    }
}

/// Downloads and caches images. Unlike `AsyncImage`, a load cut short by
/// scrolling is simply tried again next time the image shows.
@MainActor
final class ImageCache {
    static let shared = ImageCache()
    private let cache = NSCache<NSString, UIImage>()

    init() { cache.countLimit = 400 }

    func cached(_ url: String) -> UIImage? { cache.object(forKey: url as NSString) }

    func load(_ url: String) async -> UIImage? {
        if let image = cached(url) { return image }
        guard let address = URL(string: url) else { return nil }
        for attempt in 0..<3 {
            if Task.isCancelled { return nil }
            if let (data, response) = try? await URLSession.shared.data(from: address),
               (response as? HTTPURLResponse)?.statusCode ?? 200 < 400,
               let image = UIImage(data: data) {
                let thumbnail = await image.byPreparingThumbnail(ofSize: CGSize(width: 600, height: 600)) ?? image
                cache.setObject(thumbnail, forKey: url as NSString)
                return thumbnail
            }
            try? await Task.sleep(for: .seconds(Double(attempt + 1)))
        }
        return nil
    }
}

/// An image from a URL that fills its frame (gray while loading).
struct RemoteImage: View {
    let url: String?
    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Theme.surface
                }
            }
            .clipped()
            .task(id: url) {
                guard let url else { image = nil; return }
                image = ImageCache.shared.cached(url)
                if image == nil { image = await ImageCache.shared.load(url) }
            }
    }
}
