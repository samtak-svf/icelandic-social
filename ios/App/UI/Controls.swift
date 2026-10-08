import SwiftUI
import UIKit

/// A filled circle with one icon in it: the new-conversation button, the
/// composer's attach and send. The touch target stays 44pt however small
/// the circle is drawn.
struct RoundIcon: View {
    let systemImage: String
    let fill: Color
    let tint: Color
    let size: CGFloat
    var iconSize: CGFloat = 16

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: iconSize, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(fill, in: Circle())
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }
}

struct RoundButton: View {
    let systemImage: String
    let label: LocalizedStringKey
    let fill: Color
    let tint: Color
    let size: CGFloat
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            RoundIcon(systemImage: systemImage, fill: fill, tint: tint, size: size)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(label))
    }
}

/// Small capitals over a section of a screen, or a day in a conversation.
struct SectionLabel: View {
    let text: String
    var color: Color = BrandTokens.Colors.mutedFg

    var body: some View {
        Text(verbatim: text.capitals)
            .font(TypeStyle.sectionLabel)
            .tracking(TypeStyle.sectionTracking)
            .foregroundStyle(color)
    }
}

extension String {
    /// Uppercase in Icelandic, whatever the device's language ("ð" stays "Ð").
    var capitals: String { uppercased(with: Dates.icelandic) }
}

/// Its one child at most `fraction` of the width offered: a bubble leaves
/// room on the far side.
struct AtMost: Layout {
    let fraction: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        return child.sizeThatFits(ProposedViewSize(width: proposal.width.map { $0 * fraction }, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// The system's swipe back on a screen that draws its own top bar instead of
/// the navigation bar, which hiding the bar would otherwise switch off.
struct SwipeBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {}

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        private weak var original: UIGestureRecognizerDelegate?

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let recognizer = navigationController?.interactivePopGestureRecognizer,
                recognizer.delegate !== self
            else { return }
            original = recognizer.delegate
            recognizer.delegate = self
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            guard let recognizer = navigationController?.interactivePopGestureRecognizer,
                recognizer.delegate === self
            else { return }
            recognizer.delegate = original
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }
    }
}
