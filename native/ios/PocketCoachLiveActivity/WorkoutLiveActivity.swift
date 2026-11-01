import ActivityKit
import SwiftUI
import WidgetKit

// Pocket Coach colours (css/tokens.css): app background and primary text green.
private let brandBackground = Color(red: 0x0b / 255, green: 0x13 / 255, blue: 0x0d / 255)
private let brandGreen = Color(red: 0x42 / 255, green: 0xa6 / 255, blue: 0x79 / 255)

/// The workout in progress on the Lock Screen and in the Dynamic Island.
/// While resting it counts the rest down; otherwise it shows workout time.
/// iOS draws the clocks itself, so they keep ticking while the app is
/// suspended. Data: WorkoutActivityAttributes (plugins/workout-activity).
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(brandBackground)
                .activitySystemActionForegroundColor(brandGreen)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(phaseLabel(context.state, context.isStale),
                          systemImage: phaseIcon(context.state, context.isStale))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(brandGreen)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    MainClock(state: context.state, isStale: context.isStale)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 110, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(state: context.state, isStale: context.isStale)
                        .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: phaseIcon(context.state, context.isStale))
                    .foregroundStyle(brandGreen)
            } compactTrailing: {
                MainClock(state: context.state, isStale: context.isStale)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
                    .foregroundStyle(brandGreen)
            } minimal: {
                Image(systemName: phaseIcon(context.state, context.isStale))
                    .foregroundStyle(brandGreen)
            }
            .keylineTint(brandGreen)
        }
    }
}

private struct LockScreenView: View {
    let state: WorkoutActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
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

/// Rest countdown while resting, held time while paused, workout time otherwise.
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
                Text("Go")
            } else {
                Text(state.startedAt, style: .timer)
            }
        }
        .monospacedDigit()
    }
}

/// Thin bar that empties as the rest runs out. Empty when not resting.
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
        } else if let held = state.restPausedRemaining, let total = state.restTotalSeconds, total > 0 {
            ProgressView(value: Double(min(held, total)), total: Double(total))
                .progressViewStyle(.linear)
                .tint(brandGreen.opacity(0.5))
        }
    }
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
