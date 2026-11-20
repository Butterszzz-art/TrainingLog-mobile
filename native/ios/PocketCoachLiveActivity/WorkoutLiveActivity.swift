import ActivityKit
import SwiftUI
import WidgetKit

// Pocket Coach colours (css/tokens.css): app background and primary text green.
private let brandBackground = Color(red: 0x0b / 255, green: 0x13 / 255, blue: 0x0d / 255)
private let brandGreen = Color(red: 0x42 / 255, green: 0xa6 / 255, blue: 0x79 / 255)
// Rest over: the card floods with a brighter green and text turns near-black,
// so the end of a rest is obvious at a glance.
private let goGreen = Color(red: 0x5f / 255, green: 0xd3 / 255, blue: 0x9d / 255)
private let goInk = Color(red: 0x04 / 255, green: 0x14 / 255, blue: 0x0b / 255)

/// The workout in progress on the Lock Screen and in the Dynamic Island.
/// While resting it counts the rest down; otherwise it shows workout time.
/// When the rest runs out the card turns green and counts up the time since.
/// iOS draws the clocks itself, so they keep ticking while the app is
/// suspended. Data: WorkoutActivityAttributes (plugins/workout-activity).
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            let over = isRestOver(context.state, context.isStale)
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(over ? goGreen : brandBackground)
                .activitySystemActionForegroundColor(over ? goInk : brandGreen)
        } dynamicIsland: { context in
            let over = isRestOver(context.state, context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(phaseLabel(context.state, context.isStale),
                          systemImage: phaseIcon(context.state, context.isStale))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(over ? goGreen : brandGreen)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    MainClock(state: context.state, isStale: context.isStale)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(over ? goGreen : .white)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 110, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(state: context.state, isStale: context.isStale)
                        .padding(.horizontal, 4)
                }
            } compactLeading: {
                if over {
                    GoPill()
                } else {
                    Image(systemName: phaseIcon(context.state, context.isStale))
                        .foregroundStyle(brandGreen)
                }
            } compactTrailing: {
                MainClock(state: context.state, isStale: context.isStale)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
                    .foregroundStyle(over ? goGreen : brandGreen)
            } minimal: {
                if over {
                    Image(systemName: "bolt.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(goInk)
                        .padding(5)
                        .background(Circle().fill(goGreen))
                } else {
                    Image(systemName: phaseIcon(context.state, context.isStale))
                        .foregroundStyle(brandGreen)
                }
            }
            .keylineTint(over ? goGreen : brandGreen)
        }
    }
}

private struct LockScreenView: View {
    let state: WorkoutActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if isRestOver(state, isStale) {
            RestOverView(state: state)
        } else {
            activeBody
        }
    }

    private var activeBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Label(phaseLabel(state, isStale), systemImage: phaseIcon(state, isStale))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(brandGreen)
                    Text(state.exercise ?? state.title)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(progressLine(state))
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.65))
                }
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 2) {
                    MainClock(state: state, isStale: isStale)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 130, alignment: .trailing)
                    Text(clockCaption(state, isStale))
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                }
            }
            RestBar(state: state, isStale: isStale)
        }
        .padding(16)
    }
}

/// Lock Screen once the rest has run out: green card, a big "GO", the
/// exercise to go back to, and a clock counting up since the rest ended.
private struct RestOverView: View {
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Rest over · next set", systemImage: "bolt.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(goInk.opacity(0.72))
                    Text("GO")
                        .font(.system(size: 44, weight: .black))
                        .foregroundStyle(goInk)
                    Text(state.exercise ?? state.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(goInk.opacity(0.72))
                        .lineLimit(1)
                }
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 2) {
                    OvertimeClock(state: state)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .foregroundStyle(goInk)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 130, alignment: .trailing)
                    Text("since rest ended")
                        .font(.caption)
                        .foregroundStyle(goInk.opacity(0.72))
                }
            }
            Capsule()
                .fill(goInk)
                .frame(height: 4)
        }
        .padding(16)
    }
}

/// "+0:42": time since the rest ended. iOS counts a .timer Text up once
/// its date has passed, so this keeps ticking while the app is suspended.
private struct OvertimeClock: View {
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        Group {
            if let end = state.restEndsAt {
                Text("+") + Text(end, style: .timer)
            } else {
                Text("Go")
            }
        }
        .monospacedDigit()
    }
}

/// Filled "GO" badge for the compact Dynamic Island once the rest is over.
private struct GoPill: View {
    var body: some View {
        Text("GO")
            .font(.caption.weight(.heavy))
            .foregroundStyle(goInk)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(goGreen))
    }
}

private struct ExpandedBottom: View {
    let state: WorkoutActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(state.exercise ?? state.title)
                .font(.headline)
                .lineLimit(1)
            HStack {
                Text(progressLine(state))
                Spacer()
                if state.isResting {
                    // Workout time stays visible while the rest counts down.
                    Text(state.startedAt, style: .timer)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 70, alignment: .trailing)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            RestBar(state: state, isStale: isStale)
        }
    }
}

/// Rest countdown while resting, held time while paused, time since the
/// rest ended once it is over, workout time otherwise.
private struct MainClock: View {
    let state: WorkoutActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        Group {
            if let held = state.restPausedRemaining {
                Text(formatSeconds(held))
            } else if let range = state.restRange, !isStale {
                Text(timerInterval: range, countsDown: true)
            } else if state.restRange != nil {
                OvertimeClock(state: state)
            } else {
                Text(state.startedAt, style: .timer)
            }
        }
        .monospacedDigit()
    }
}

/// Thin bar that empties as the rest runs out. Full when the rest is over,
/// empty when not resting.
private struct RestBar: View {
    let state: WorkoutActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if let range = state.restRange, !isStale {
            ProgressView(timerInterval: range, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .progressViewStyle(.linear)
            .tint(brandGreen)
        } else if isRestOver(state, isStale) {
            Capsule()
                .fill(goGreen)
                .frame(height: 4)
        } else if let held = state.restPausedRemaining, let total = state.restTotalSeconds, total > 0 {
            ProgressView(value: Double(min(held, total)), total: Double(total))
                .progressViewStyle(.linear)
                .tint(brandGreen.opacity(0.5))
        }
    }
}

/// The rest ran out and nothing has updated the activity since. The
/// activity goes stale at restEndsAt (WorkoutActivityPlugin), so iOS
/// redraws it in this state without the app running.
private func isRestOver(_ state: WorkoutActivityAttributes.ContentState, _ isStale: Bool) -> Bool {
    isStale && state.restRange != nil
}

private func phaseLabel(_ state: WorkoutActivityAttributes.ContentState, _ isStale: Bool) -> String {
    if state.restPausedRemaining != nil { return "Rest paused" }
    if state.restRange != nil { return isStale ? "Rest over" : "Resting" }
    return "Workout"
}

private func phaseIcon(_ state: WorkoutActivityAttributes.ContentState, _ isStale: Bool) -> String {
    if state.restPausedRemaining != nil { return "pause.circle.fill" }
    if state.restRange != nil { return isStale ? "bolt.fill" : "timer" }
    return "dumbbell.fill"
}

private func clockCaption(_ state: WorkoutActivityAttributes.ContentState, _ isStale: Bool) -> String {
    if state.restPausedRemaining != nil { return "paused" }
    if state.restRange != nil { return isStale ? "next set" : "rest left" }
    return "workout time"
}

private func progressLine(_ state: WorkoutActivityAttributes.ContentState) -> String {
    let sets = state.setsDone == 1 ? "1 set" : "\(state.setsDone) sets"
    let exercises = state.exercisesDone == 1 ? "1 exercise" : "\(state.exercisesDone) exercises"
    return "\(sets) · \(exercises)"
}

private func formatSeconds(_ total: Int) -> String {
    let s = max(0, total)
    return String(format: "%d:%02d", s / 60, s % 60)
}
