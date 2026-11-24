import Foundation

/// Where the app leaves the Today widget's data, and its shape. Compiled into
/// both the app (WorkoutActivityPlugin writes it) and the widget extension
/// (scripts/ios/add-live-activity.rb copies this file there), so the two
/// always agree.
public enum TodayWidgetStore {
    /// The widget's kind, used to ask WidgetKit to redraw it.
    public static let kind = "PocketCoachToday"
    /// UserDefaults key holding the JSON snapshot.
    public static let key = "todayWidgetSnapshot"

    /// The App Group shared by the app and the extension. Both Info.plists
    /// carry it under PocketCoachAppGroup (codemagic.yaml for the app,
    /// add-live-activity.rb for the extension).
    public static var groupId: String? {
        Bundle.main.object(forInfoDictionaryKey: "PocketCoachAppGroup") as? String
    }

    public static var defaults: UserDefaults? {
        guard let id = groupId, !id.isEmpty else { return nil }
        return UserDefaults(suiteName: id)
    }

    public static func load() -> TodayWidgetSnapshot? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(TodayWidgetSnapshot.self, from: data)
    }
}

/// Built by src/js/home-widget.js (buildSnapshot); keep the two in step.
public struct TodayWidgetSnapshot: Codable, Equatable {
    public struct Macro: Codable, Equatable {
        public var eaten: Int
        public var target: Int

        public var left: Int { max(0, target - eaten) }
        public var fraction: Double {
            target > 0 ? min(1, Double(eaten) / Double(target)) : 0
        }
    }

    /// Performance mode's summary (src/js/performance-mode.js
    /// getWidgetSummary); nil while it's off. The widget swaps its macro
    /// layout for this one while it's set.
    public struct Performance: Codable, Equatable {
        public var dayName: String?
        /// Workout timer start, ms since 1970.
        public var startedAtMs: Double?
        public var doneSets: Int
        /// 0 without a plan for today.
        public var plannedSets: Int
        public var volumeKg: Int
        /// "Bench Press · Set 4"
        public var nextUp: String?
        /// A running rest ends here, ms since 1970.
        public var restEndsAtMs: Double?
        /// A paused rest has this many seconds left.
        public var restPausedSeconds: Int?
        public var budgetMin: Int?
        /// "ahead" | "on" | "behind" | "over" | "done", with a budget.
        public var pace: String?
        public var behindMin: Int?

        public var startedAt: Date? { startedAtMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
        public var restEndsAt: Date? { restEndsAtMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
        public var setsFraction: Double {
            plannedSets > 0 ? min(1, Double(doneSets) / Double(plannedSets)) : 0
        }
    }

    /// Local calendar day the snapshot was made for, "YYYY-MM-DD".
    public var date: String
    public var eyebrow: String
    public var title: String
    public var isTraining: Bool
    public var done: Bool
    public var tomorrowEyebrow: String?
    public var tomorrowTitle: String?
    public var tomorrowIsTraining: Bool?
    public var kcal: Macro
    public var protein: Macro
    public var carbs: Macro
    public var fat: Macro
    /// Optional so snapshots written before performance mode still decode.
    public var performance: Performance?

    /// The snapshot as it should read on the day after `date`: tomorrow's
    /// session (when known) and nothing eaten yet.
    public func rolledOver() -> TodayWidgetSnapshot {
        var next = self
        next.eyebrow = tomorrowEyebrow ?? eyebrow
        next.title = tomorrowTitle ?? "Open Pocket Coach"
        next.isTraining = tomorrowIsTraining ?? false
        next.done = false
        next.tomorrowEyebrow = nil
        next.tomorrowTitle = nil
        next.tomorrowIsTraining = nil
        next.kcal.eaten = 0
        next.protein.eaten = 0
        next.carbs.eaten = 0
        next.fat.eaten = 0
        next.performance = nil
        return next
    }
}
