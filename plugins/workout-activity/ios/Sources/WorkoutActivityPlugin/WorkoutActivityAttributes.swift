import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// The data behind the workout Live Activity.
///
/// This one file is compiled into both the app (by this plugin) and the
/// widget extension (scripts/ios/add-live-activity.rb copies it there).
/// ActivityKit matches the two by type name, so keep a single copy and
/// never rename it.
@available(iOS 16.1, *)
public struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Workout title, e.g. "Push day".
        public var title: String
        /// When the workout timer started (drives the elapsed clock).
        public var startedAt: Date
        /// The exercise logged most recently, if any.
        public var exercise: String?
        public var setsDone: Int
        public var exercisesDone: Int
        /// Set while a rest is counting down.
        public var restEndsAt: Date?
        public var restTotalSeconds: Int?
        /// Set while a rest is paused: the seconds it is holding.
        public var restPausedRemaining: Int?

        public init(title: String, startedAt: Date, exercise: String?, setsDone: Int,
                    exercisesDone: Int, restEndsAt: Date?, restTotalSeconds: Int?,
                    restPausedRemaining: Int?) {
            self.title = title
            self.startedAt = startedAt
            self.exercise = exercise
            self.setsDone = setsDone
            self.exercisesDone = exercisesDone
            self.restEndsAt = restEndsAt
            self.restTotalSeconds = restTotalSeconds
            self.restPausedRemaining = restPausedRemaining
        }

        /// The rest window as a valid range, or nil when not resting.
        /// Text(timerInterval:) crashes on a range whose start is after its end.
        public var restRange: ClosedRange<Date>? {
            guard restPausedRemaining == nil,
                  let end = restEndsAt,
                  let total = restTotalSeconds, total > 0 else { return nil }
            return end.addingTimeInterval(-Double(total))...end
        }

        public var isResting: Bool { restRange != nil || restPausedRemaining != nil }
    }

    public init() {}
}
#endif
