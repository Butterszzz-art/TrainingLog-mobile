import SwiftUI
import WidgetKit

// Home Screen "Today" widget (medium): calories left in a ring, the program
// day, and protein / carbs / fat left. The app writes the data
// (src/js/home-widget.js → WorkoutActivityPlugin.updateWidget → App Group);
// this only draws it. Design: "B · Macro-first banner". While performance
// mode is on in the app it shows that mode's summary instead: workout clock
// in the ring, sets done of planned, volume, next up and the rest timer.

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
        fat: .init(eaten: 41, target: 80),
        performance: nil)

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
        var dates = [now]
        // A running rest: redraw when it ends so the countdown turns to "Go".
        if let end = stored?.performance?.restEndsAt, end > now, end < midnight { dates.append(end) }
        // An abandoned performance session (app killed mid-workout) stops
        // showing once it's implausibly long.
        if let start = stored?.performance?.startedAt {
            let expiry = start.addingTimeInterval(Self.performanceMaxAge)
            if expiry > now, expiry < midnight { dates.append(expiry) }
        }
        dates.append(midnight)
        let entries = dates.sorted().map { day in TodayEntry(date: day, snapshot: stored.map { Self.asOf(day, $0) }) }
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60))))
    }

    static let performanceMaxAge: TimeInterval = 4 * 60 * 60

    /// The snapshot as it reads on `day`: unchanged on its own day, rolled
    /// over the day after, and a prompt to open the app once it's older.
    static func asOf(_ day: Date, _ snap: TodayWidgetSnapshot) -> TodayWidgetSnapshot {
        let calendar = Calendar.current
        let today = dateKey(day)
        if snap.date == today {
            var current = snap
            if let start = snap.performance?.startedAt, day.timeIntervalSince(start) >= performanceMaxAge {
                current.performance = nil
            }
            return current
        }
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

private let boltColor = Color(red: 0xf0 / 255, green: 0xb8 / 255, blue: 0x4b / 255)
private let behindColor = Color(red: 0xe8 / 255, green: 0x8b / 255, blue: 0x7b / 255)

/// Performance mode's ring: sets done of planned around the workout clock.
private struct WorkoutRing: View {
    let perf: TodayWidgetSnapshot.Performance

    /// iOS ticks a .timer Text by itself, so the clock runs without updates.
    private var clock: Text {
        if let start = perf.startedAt { return Text(start, style: .timer) }
        return Text("—")
    }

    var body: some View {
        ZStack {
            Circle().stroke(track, lineWidth: 10)
            Circle()
                .trim(from: 0, to: perf.setsFraction)
                .stroke(ringGreen, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                clock
                .font(.system(size: 22, weight: .heavy))
                .fontWidth(.condensed)
                .monospacedDigit()
                .multilineTextAlignment(.center)
                .foregroundStyle(textPrimary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                Text("WORKOUT")
                    .font(.system(size: 10, weight: .bold))
                    .fontWidth(.condensed)
                    .tracking(1)
                    .foregroundStyle(textMuted)
            }
            .padding(.horizontal, 14)
        }
        .frame(width: 112, height: 112)
        .accessibilityElement(children: .combine)
    }
}

/// One stat under the performance title, styled like a MacroColumn.
private struct StatColumn<Value: View>: View {
    let label: String
    let color: Color
    let value: Value
    let unit: String
    let fraction: Double?

    init(_ label: String, color: Color, unit: String = "", fraction: Double? = nil, @ViewBuilder value: () -> Value) {
        self.label = label
        self.color = color
        self.unit = unit
        self.fraction = fraction
        self.value = value()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold))
                .fontWidth(.condensed)
                .tracking(0.8)
                .foregroundStyle(color)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                value
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(textPrimary)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(textSoft)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(track)
                    Capsule().fill(color).frame(width: geo.size.width * (fraction ?? 0))
                }
            }
            .frame(height: 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry

    var body: some View {
        Group {
            if let snap = entry.snapshot, let perf = snap.performance {
                performance(perf, snap)
            } else if let snap = entry.snapshot {
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

    private func performance(_ perf: TodayWidgetSnapshot.Performance, _ snap: TodayWidgetSnapshot) -> some View {
        let now = entry.date
        let resting = perf.restEndsAt.map { $0 > now } ?? false
        let volume = perf.volumeKg >= 10_000
            ? String(format: "%.1f", Double(perf.volumeKg) / 1000)
            : perf.volumeKg.formatted()
        return HStack(spacing: 16) {
            WorkoutRing(perf: perf)
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(boltColor)
                        Text(perf.dayName.map { "Performance · \($0)" }?.uppercased() ?? "PERFORMANCE MODE")
                            .font(.system(size: 12, weight: .bold))
                            .fontWidth(.condensed)
                            .tracking(1)
                            .foregroundStyle(textMuted)
                            .lineLimit(1)
                    }
                    Text((perf.nextUp.map { "Next · \($0)" } ?? snap.title).uppercased())
                        .font(.system(size: 21, weight: .heavy))
                        .fontWidth(.condensed)
                        .foregroundStyle(textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                HStack(spacing: 8) {
                    StatColumn("Sets", color: proteinColor,
                               unit: perf.plannedSets > 0 ? "/ \(perf.plannedSets)" : "done",
                               fraction: perf.plannedSets > 0 ? perf.setsFraction : nil) {
                        Text("\(perf.doneSets)")
                    }
                    StatColumn("Volume", color: carbsColor, unit: perf.volumeKg >= 10_000 ? "t" : "kg") {
                        Text(volume)
                    }
                    restOrPace(perf, now: now, resting: resting)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Rest countdown while resting (or paused); otherwise the pace against
    /// the time budget, or "Go" when there's no budget.
    @ViewBuilder
    private func restOrPace(_ perf: TodayWidgetSnapshot.Performance, now: Date, resting: Bool) -> some View {
        if resting, let end = perf.restEndsAt {
            StatColumn("Rest", color: fatColor) {
                Text(timerInterval: now...end, countsDown: true)
            }
        } else if let paused = perf.restPausedSeconds, paused > 0 {
            StatColumn("Rest", color: fatColor, unit: "paused") {
                Text(String(format: "%d:%02d", paused / 60, paused % 60))
            }
        } else if let budget = perf.budgetMin, let pace = perf.pace {
            let (text, unit): (String, String) = {
                switch pace {
                case "behind": return ("\(perf.behindMin ?? 0)", "min behind")
                case "ahead": return ("Ahead", "")
                case "over": return ("Over", "\(budget) min")
                case "done": return ("Done", "")
                default: return ("On", "pace")
                }
            }()
            StatColumn("Pace", color: pace == "behind" || pace == "over" ? behindColor : ringGreen, unit: unit) {
                Text(text)
            }
        } else {
            StatColumn("Rest", color: fatColor, unit: "") {
                Text("Go")
            }
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
