import SwiftUI
import WidgetKit

// Home Screen "Today" widget (medium): calories left in a ring, the program
// day, and protein / carbs / fat left. The app writes the data
// (src/js/home-widget.js → WorkoutActivityPlugin.updateWidget → App Group);
// this only draws it. Design: "B · Macro-first banner".

private let surface = Color(red: 0x0e / 255, green: 0x14 / 255, blue: 0x11 / 255)
private let track = Color(red: 0x22 / 255, green: 0x2c / 255, blue: 0x26 / 255)
private let ringGreen = Color(red: 0x5f / 255, green: 0xd3 / 255, blue: 0x9d / 255)
private let textPrimary = Color(red: 0xf4 / 255, green: 0xf7 / 255, blue: 0xf5 / 255)
private let textMuted = Color(red: 0x8c / 255, green: 0x98 / 255, blue: 0x91 / 255)
private let textSoft = Color(red: 0xa9 / 255, green: 0xb8 / 255, blue: 0xb0 / 255)
private let proteinColor = Color(red: 0x7e / 255, green: 0xc8 / 255, blue: 0xa4 / 255)
private let carbsColor = Color(red: 0xf0 / 255, green: 0xb8 / 255, blue: 0x4b / 255)
private let fatColor = Color(red: 0xe8 / 255, green: 0x8b / 255, blue: 0x7b / 255)

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
    let date: Date
    /// nil until the app has written a snapshot (or after signing out).
    let snapshot: TodayWidgetSnapshot?
}

struct TodayProvider: TimelineProvider {
    static let sample = TodayWidgetSnapshot(
        date: "", eyebrow: "Hypertrophy · Wk 3", title: "Day 4 · Push",
        isTraining: true, done: false,
        tomorrowEyebrow: nil, tomorrowTitle: nil, tomorrowIsTraining: nil,
        kcal: .init(eaten: 1230, target: 2650),
        protein: .init(eaten: 112, target: 190),
        carbs: .init(eaten: 128, target: 300),
        fat: .init(eaten: 41, target: 80))

    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        let stored = TodayWidgetStore.load()
        completion(TodayEntry(date: Date(), snapshot: context.isPreview ? (stored ?? Self.sample) : stored))
    }

    /// Today's entry, plus one at midnight that moves to tomorrow's session
    /// with nothing eaten, so the widget is right in the morning even before
    /// the app is opened.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let calendar = Calendar.current
        let now = Date()
        let midnight = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
        let stored = TodayWidgetStore.load()
        let entries = [
            TodayEntry(date: now, snapshot: stored.map { Self.asOf(now, $0) }),
            TodayEntry(date: midnight, snapshot: stored.map { Self.asOf(midnight, $0) })
        ]
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60))))
    }

    /// The snapshot as it reads on `day`: unchanged on its own day, rolled
    /// over the day after, and a prompt to open the app once it's older.
    static func asOf(_ day: Date, _ snap: TodayWidgetSnapshot) -> TodayWidgetSnapshot {
        let calendar = Calendar.current
        let today = dateKey(day)
        if snap.date == today { return snap }
        let yesterday = calendar.date(byAdding: .day, value: -1, to: day).map(dateKey)
        var rolled = snap.rolledOver()
        if snap.date != yesterday {
            rolled.title = "Open Pocket Coach"
            rolled.isTraining = false
        }
        return rolled
    }

    static func dateKey(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

// MARK: - Views

private extension View {
    /// iOS 17 draws widget backgrounds and margins itself; older systems need both by hand.
    @ViewBuilder func todayWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(surface, for: .widget)
        } else {
            padding(16).background(surface)
        }
    }
}

private struct CaloriesRing: View {
    let kcal: TodayWidgetSnapshot.Macro

    private var spoken: String {
        kcal.target > 0 ? "\(kcal.left) calories left of \(kcal.target)" : "\(kcal.eaten) calories eaten"
    }

    var body: some View {
        let hasTarget = kcal.target > 0
        ZStack {
            Circle().stroke(track, lineWidth: 10)
            Circle()
                .trim(from: 0, to: hasTarget ? kcal.fraction : 0)
                .stroke(ringGreen, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text((hasTarget ? kcal.left : kcal.eaten).formatted())
                    .font(.system(size: 26, weight: .heavy))
                    .fontWidth(.condensed)
                    .foregroundStyle(textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(hasTarget ? "KCAL LEFT" : "KCAL EATEN")
                    .font(.system(size: 10, weight: .bold))
                    .fontWidth(.condensed)
                    .tracking(1)
                    .foregroundStyle(textMuted)
            }
            .padding(.horizontal, 14)
        }
        .frame(width: 112, height: 112)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spoken))
    }
}

private struct MacroColumn: View {
    let label: String
    let color: Color
    let macro: TodayWidgetSnapshot.Macro

    private var spoken: String {
        macro.target > 0
            ? "\(label): \(macro.left) grams left of \(macro.target)"
            : "\(label): \(macro.eaten) grams eaten"
    }

    var body: some View {
        let hasTarget = macro.target > 0
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold))
                .fontWidth(.condensed)
                .tracking(0.8)
                .foregroundStyle(color)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(hasTarget ? macro.left : macro.eaten)g")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(textPrimary)
                Text(hasTarget ? "left" : "eaten")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(textSoft)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(track)
                    Capsule().fill(color).frame(width: geo.size.width * macro.fraction)
                }
            }
            .frame(height: 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spoken))
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry

    var body: some View {
        Group {
            if let snap = entry.snapshot {
                content(snap)
            } else {
                empty
            }
        }
        .todayWidgetBackground()
    }

    private func content(_ snap: TodayWidgetSnapshot) -> some View {
        HStack(spacing: 16) {
            CaloriesRing(kcal: snap.kcal)
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(snap.eyebrow.uppercased())
                        .font(.system(size: 12, weight: .bold))
                        .fontWidth(.condensed)
                        .tracking(1)
                        .foregroundStyle(textMuted)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(snap.title.uppercased())
                            .font(.system(size: 21, weight: .heavy))
                            .fontWidth(.condensed)
                            .foregroundStyle(textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        if snap.done {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(ringGreen)
                                .accessibilityLabel("Done")
                        }
                    }
                }
                HStack(spacing: 8) {
                    MacroColumn(label: "Protein", color: proteinColor, macro: snap.protein)
                    MacroColumn(label: "Carbs", color: carbsColor, macro: snap.carbs)
                    MacroColumn(label: "Fat", color: fatColor, macro: snap.fat)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("POCKET COACH")
                .font(.system(size: 12, weight: .bold))
                .fontWidth(.condensed)
                .tracking(1)
                .foregroundStyle(ringGreen)
            Text("Open the app to see today's session and macros here.")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(textPrimary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: TodayWidgetStore.kind, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's session and the calories and macros you have left.")
        .supportedFamilies([.systemMedium])
    }
}
