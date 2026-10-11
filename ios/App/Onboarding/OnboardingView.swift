import PhotosUI
import SwiftUI

/// The first launch (decision 0043), one step at a time on cream: a photo, set with the picker and
/// upload of "Ég", beside the name sign-in delivered, which cannot be edited here; then why
/// notifications are worth having, and only on a tap the system's prompt.
struct OnboardingView: View {
    let model: OnboardingModel
    let me: MeModel

    @State private var picked: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch model.step {
            case .photo: photoStep
            case .notifications: notificationsStep
            case .done: EmptyView()
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg)
        .task { if me.me == nil { await me.load() } }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            picked = nil
            let photo = Picked(photo: item)
            Task { await me.setPhoto { try await profilePhoto(photo) } }
        }
    }

    private var photoStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Title(key: "onboarding_photo_title")
                    BodyText(key: "onboarding_photo_body")
                    Avatar(name: me.me?.name, kind: .me, size: 96, photo: me.me?.photoOf)
                        .padding(.top, 8)
                    if let name = me.me?.name {
                        Text(verbatim: name.capitals)
                            .font(TypeStyle.accountName)
                            .foregroundStyle(BrandTokens.Colors.fg)
                    }
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if me.busy {
                ProgressView().progressViewStyle(.linear)
            }
            if let problem = me.problem {
                ProblemCard(problem: problem) { Task { await me.retry() } }
            }
            if me.me?.photo != nil {
                Primary(key: "onboarding_continue") { Task { await model.photoDone() } }
                PhotosPicker(selection: $picked, matching: .images) { SecondaryLabel(key: "photo_change") }
                    .buttonStyle(.plain)
                    .disabled(me.busy)
            } else {
                PhotosPicker(selection: $picked, matching: .images) { PrimaryLabel(key: "photo_choose") }
                    .buttonStyle(.plain)
                    .disabled(me.busy)
                Secondary(key: "onboarding_skip") { Task { await model.photoDone() } }
            }
        }
    }

    private var notificationsStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "bell")
                        .font(.system(size: 44))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .accessibilityHidden(true)
                    Title(key: "notifications_priming_title")
                    BodyText(key: "notifications_priming_body")
                }
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Primary(key: "notifications_enable") { Task { await model.enable() } }
            Secondary(key: "not_now") { model.notNow() }
        }
    }
}

private struct Title: View {
    let key: LocalizedStringKey

    var body: some View {
        Text(key)
            .font(TypeStyle.accountName)
            .foregroundStyle(BrandTokens.Colors.fg)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct BodyText: View {
    let key: LocalizedStringKey

    var body: some View {
        Text(key)
            .font(.sans(15))
            .lineSpacing(3)
            .foregroundStyle(BrandTokens.Colors.fg)
    }
}

/// The step's main action: a full-width pill, as on the Kenni offer.
private struct PrimaryLabel: View {
    let key: LocalizedStringKey

    var body: some View {
        Text(key)
            .font(.sans(15, black: true))
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(BrandTokens.Colors.primary, in: Capsule())
            .contentShape(Capsule())
    }
}

private struct SecondaryLabel: View {
    let key: LocalizedStringKey

    var body: some View {
        Text(key)
            .font(.sans(14, black: true))
            .foregroundStyle(BrandTokens.Colors.fg)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
    }
}

private struct Primary: View {
    let key: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) { PrimaryLabel(key: key) }.buttonStyle(.plain)
    }
}

private struct Secondary: View {
    let key: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) { SecondaryLabel(key: key) }.buttonStyle(.plain)
    }
}
