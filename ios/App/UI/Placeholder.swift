import SwiftUI

/// Grey rows where a list's rows will be, until its first read returns (decision 0043): a blank
/// screen reads as a broken one. The shapes say nothing; the whole is one element read as "loading".
/// They pulse unless Reduce Motion is on.
struct PlaceholderRows: View {
    enum Kind { case conversation, post }

    let kind: Kind
    var count = 6

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { index in
                switch kind {
                case .conversation: conversation(index)
                case .post: post(index)
                }
                Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
            }
        }
        .opacity(dim ? 0.45 : 1)
        .onAppear {
            guard Motion.pulses(reduceMotion: reduceMotion) else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("loading"))
    }

    /// An avatar, a name and a preview line, as a conversation row has.
    private func conversation(_ index: Int) -> some View {
        HStack(spacing: 12) {
            Circle().fill(BrandTokens.Colors.muted).frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 8) {
                bar(Self.names[index % Self.names.count])
                bar(Self.lines[index % Self.lines.count])
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
    }

    /// An avatar beside a name and three lines of text, as a post has.
    private func post(_ index: Int) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().fill(BrandTokens.Colors.muted).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 8) {
                bar(Self.names[index % Self.names.count])
                bar(1)
                bar(1)
                bar(Self.lines[index % Self.lines.count])
            }
        }
        .padding(16)
    }

    private func bar(_ share: CGFloat) -> some View {
        GeometryReader { geometry in
            Capsule().fill(BrandTokens.Colors.muted).frame(width: geometry.size.width * share, height: 10)
        }
        .frame(height: 10)
    }

    /// Rows of different lengths, so the shapes read as rows and not as a pattern.
    private static let names: [CGFloat] = [0.45, 0.35, 0.55]
    private static let lines: [CGFloat] = [0.8, 0.65, 0.72, 0.58]
}
