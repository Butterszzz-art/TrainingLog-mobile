import Foundation
import UIKit
import Capacitor
import HealthKit

/// Apple Health for Pocket Coach.
///
/// Reads: steps, walking/running distance, active + resting energy, exercise
/// minutes, sleep, resting heart rate, HRV, SpO2, respiratory rate, VO2 max,
/// bodyweight, body fat, workouts, and food (energy, protein, carbs, fat).
/// Writes: lifting workouts and bodyweight logged in the app.
///
/// JS side: src/js/apple-health.js (activity, sleep, recovery, body, cardio)
/// and src/js/health-nutrition.js (food import; the getStatus /
/// requestPermission / getNutritionTotals / openHealthConnect methods match
/// the Android Health Connect plugin, so the same code drives both).
///
/// Dates in and out: days are "YYYY-MM-DD" in the phone's time zone; times
/// are epoch milliseconds or ISO 8601 strings.
///
/// Needs the HealthKit entitlement and NSHealthShareUsageDescription /
/// NSHealthUpdateUsageDescription (scripts/ios/add-capabilities.rb and
/// codemagic.yaml add them).
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDailyTotals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDailyVitals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWeighIns", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBodyMass", returnType: CAPPluginReturnPromise),
        // Same names as the Android Health Connect plugin (food import).
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNutritionTotals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openHealthConnect", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    // MARK: - Types

    private func quantity(_ id: HKQuantityTypeIdentifier) -> HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: id)
    }

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        let ids: [HKQuantityTypeIdentifier] = [
            .stepCount, .distanceWalkingRunning, .activeEnergyBurned, .basalEnergyBurned,
            .appleExerciseTime, .restingHeartRate, .heartRateVariabilitySDNN,
            .oxygenSaturation, .respiratoryRate, .vo2Max, .bodyMass, .bodyFatPercentage,
            .dietaryEnergyConsumed, .dietaryProtein, .dietaryCarbohydrates, .dietaryFatTotal
        ]
        ids.compactMap { quantity($0) }.forEach { types.insert($0) }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    private var writeTypes: Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType()]
        [HKQuantityTypeIdentifier.activeEnergyBurned, .bodyMass].compactMap { quantity($0) }.forEach { types.insert($0) }
        return types
    }

    private static let countPerMinute = HKUnit.count().unitDivided(by: HKUnit.minute())

    // MARK: - Dates

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    // Calendar maths instead of a shared DateFormatter: queries call back on
    // several threads at once, and DateFormatter isn't safe for that.
    private func dayKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func parseDay(_ value: String?) -> Date? {
        guard let parts = value?.split(separator: "-").compactMap({ Int($0) }), parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private func iso(_ date: Date) -> String {
        HealthKitPlugin.isoFormatter.string(from: date)
    }

    /// Start of the first day and start of the day after the last one.
    private func dayRange(_ call: CAPPluginCall) -> (start: Date, end: Date)? {
        guard let start = parseDay(call.getString("start")),
              let endDay = parseDay(call.getString("end")),
              let end = Calendar.current.date(byAdding: .day, value: 1, to: endDay),
              start < end else { return nil }
        return (Calendar.current.startOfDay(for: start), Calendar.current.startOfDay(for: end))
    }

    private func guardAvailable(_ call: CAPPluginCall) -> Bool {
        if HKHealthStore.isHealthDataAvailable() { return true }
        call.reject("Apple Health isn't available on this device", "UNAVAILABLE")
        return false
    }

    // MARK: - Permission

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// Shows Apple's permission sheet (only the first time; after that it
    /// returns straight away). iOS never says whether reading was allowed,
    /// so `granted` only means the sheet was answered.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        store.requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
            if let error = error {
                call.reject(error.localizedDescription, "AUTH_FAILED")
            } else {
                call.resolve(["granted": success])
            }
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        requestAuthorization(call)
    }

    /// Health Connect-shaped status: { status: 'available'|'unavailable', granted }.
    /// `granted` is true once the permission sheet has been answered.
    @objc func getStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "unavailable", "granted": false])
            return
        }
        store.getRequestStatusForAuthorization(toShare: writeTypes, read: readTypes) { status, _ in
            call.resolve(["status": "available", "granted": status == .unnecessary])
        }
    }

    @objc func openHealthConnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: "x-apple-health://"), UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            } else if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    // MARK: - Daily statistics

    /// One statistic per day for one type: [dayKey: value].
    private func daily(_ type: HKQuantityType, unit: HKUnit, options: HKStatisticsOptions,
                       start: Date, end: Date, scale: Double = 1,
                       completion: @escaping ([String: Double]) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                                                options: options, anchorDate: start,
                                                intervalComponents: DateComponents(day: 1))
        query.initialResultsHandler = { [weak self] _, results, _ in
            var out: [String: Double] = [:]
            results?.enumerateStatistics(from: start, to: end) { stats, _ in
                let q = options.contains(.cumulativeSum) ? stats.sumQuantity() : stats.averageQuantity()
                if let q = q, let key = self?.dayKey(stats.startDate) {
                    out[key] = q.doubleValue(for: unit) * scale
                }
            }
            completion(out)
        }
        store.execute(query)
    }

    private struct Metric {
        let key: String
        let id: HKQuantityTypeIdentifier
        let unit: HKUnit
        let options: HKStatisticsOptions
        var scale: Double = 1
    }

    /// Runs the metrics in parallel and returns one row per day in range.
    private func dailyRows(_ metrics: [Metric], start: Date, end: Date,
                           completion: @escaping ([[String: Any]]) -> Void) {
        let group = DispatchGroup()
        let lock = NSLock()
        var byMetric: [String: [String: Double]] = [:]
        for m in metrics {
            guard let type = quantity(m.id) else { continue }
            group.enter()
            daily(type, unit: m.unit, options: m.options, start: start, end: end, scale: m.scale) { values in
                lock.lock(); byMetric[m.key] = values; lock.unlock()
                group.leave()
            }
        }
        group.notify(queue: .global()) { [weak self] in
            guard let self = self else { return }
            var rows: [[String: Any]] = []
            var day = start
            while day < end {
                let key = self.dayKey(day)
                var row: [String: Any] = ["date": key]
                var hasData = false
                for m in metrics {
                    if let v = byMetric[m.key]?[key] {
                        row[m.key] = v
                        hasData = true
                    } else {
                        row[m.key] = NSNull()
                    }
                }
                row["hasData"] = hasData
                rows.append(row)
                guard let next = Calendar.current.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
            completion(rows)
        }
    }

    /// { days: [{ date, steps, distanceKm, activeKcal, basalKcal, exerciseMinutes, hasData }] }
    @objc func getDailyTotals(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let range = dayRange(call) else { return call.reject("start and end (YYYY-MM-DD) are required") }
        let start = range.start, end = range.end
        let metrics = [
            Metric(key: "steps", id: .stepCount, unit: .count(), options: .cumulativeSum),
            Metric(key: "distanceKm", id: .distanceWalkingRunning, unit: .meterUnit(with: .kilo), options: .cumulativeSum),
            Metric(key: "activeKcal", id: .activeEnergyBurned, unit: .kilocalorie(), options: .cumulativeSum),
            Metric(key: "basalKcal", id: .basalEnergyBurned, unit: .kilocalorie(), options: .cumulativeSum),
            Metric(key: "exerciseMinutes", id: .appleExerciseTime, unit: .minute(), options: .cumulativeSum)
        ]
        dailyRows(metrics, start: start, end: end) { call.resolve(["days": $0]) }
    }

    /// { days: [{ date, restingHeartRate, hrvMs, spo2, respiratoryRate, vo2Max, hasData }] }
    @objc func getDailyVitals(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let range = dayRange(call) else { return call.reject("start and end (YYYY-MM-DD) are required") }
        let start = range.start, end = range.end
        let metrics = [
            Metric(key: "restingHeartRate", id: .restingHeartRate, unit: HealthKitPlugin.countPerMinute, options: .discreteAverage),
            Metric(key: "hrvMs", id: .heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), options: .discreteAverage),
            Metric(key: "spo2", id: .oxygenSaturation, unit: .percent(), options: .discreteAverage, scale: 100),
            Metric(key: "respiratoryRate", id: .respiratoryRate, unit: HealthKitPlugin.countPerMinute, options: .discreteAverage),
            Metric(key: "vo2Max", id: .vo2Max, unit: HKUnit(from: "ml/kg*min"), options: .discreteAverage)
        ]
        dailyRows(metrics, start: start, end: end) { call.resolve(["days": $0]) }
    }

    // MARK: - Samples

    private func samples(_ type: HKSampleType, start: Date, end: Date, ascending: Bool = true,
                         limit: Int = HKObjectQueryNoLimit,
                         completion: @escaping ([HKSample]) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: ascending)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: [sort]) { _, results, _ in
            completion(results ?? [])
        }
        store.execute(query)
    }

    private func isFromThisApp(_ sample: HKSample) -> Bool {
        sample.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier
    }

    /// { weighIns: [{ date, weightKg, bodyFatPercent }] } — the first reading of each day.
    @objc func getWeighIns(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let range = dayRange(call) else { return call.reject("start and end (YYYY-MM-DD) are required") }
        let start = range.start, end = range.end
        guard let mass = quantity(.bodyMass), let fat = quantity(.bodyFatPercentage) else { return call.resolve(["weighIns": []]) }
        let group = DispatchGroup()
        var massSamples: [HKSample] = []
        var fatSamples: [HKSample] = []
        group.enter()
        samples(mass, start: start, end: end) { massSamples = $0; group.leave() }
        group.enter()
        samples(fat, start: start, end: end) { fatSamples = $0; group.leave() }
        group.notify(queue: .global()) { [weak self] in
            guard let self = self else { return }
            var rows: [String: [String: Any]] = [:]
            // Readings the app saved itself are already in its weight log.
            for s in massSamples.compactMap({ $0 as? HKQuantitySample }) where !self.isFromThisApp(s) {
                let key = self.dayKey(s.startDate)
                if rows[key]?["weightKg"] != nil { continue }
                var row = rows[key] ?? ["date": key, "bodyFatPercent": NSNull()]
                row["weightKg"] = s.quantity.doubleValue(for: .gramUnit(with: .kilo))
                rows[key] = row
            }
            for s in fatSamples.compactMap({ $0 as? HKQuantitySample }) {
                let key = self.dayKey(s.startDate)
                var row = rows[key] ?? ["date": key, "weightKg": NSNull()]
                if let existing = row["bodyFatPercent"], !(existing is NSNull) { continue }
                row["bodyFatPercent"] = s.quantity.doubleValue(for: .percent()) * 100
                rows[key] = row
            }
            let sorted = rows.values.sorted { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") }
            call.resolve(["weighIns": sorted])
        }
    }

    /// Last night's sleep, for the night that ends on `date`: sessions ending
    /// from noon the day before to noon on `date`. When several sources
    /// recorded the night (Watch and iPhone), the one with the most sleep wins.
    /// { sleep: { bedtime, wakeTime, sleepMinutes, timeInBedMinutes, lightMinutes,
    ///   deepMinutes, remMinutes, awakeMinutes, awakenings } | null }
    @objc func getSleep(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let day = parseDay(call.getString("date")),
              let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return call.reject("date (YYYY-MM-DD) is required")
        }
        let noon = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day
        let windowStart = noon.addingTimeInterval(-24 * 3600)
        // Fetch a little wider, then keep samples that end inside the window.
        samples(type, start: windowStart.addingTimeInterval(-12 * 3600), end: noon) { [weak self] all in
            guard let self = self else { return }
            let list = all.compactMap { $0 as? HKCategorySample }
                .filter { $0.endDate > windowStart && $0.endDate <= noon }
            // Raw values: 0 inBed, 1 asleepUnspecified, 2 awake, 3 core, 4 deep, 5 REM.
            let asleepValues: Set<Int> = [1, 3, 4, 5]
            var bySource: [String: [HKCategorySample]] = [:]
            list.forEach { bySource[$0.sourceRevision.source.bundleIdentifier, default: []].append($0) }
            func asleepMinutes(_ s: [HKCategorySample]) -> Double {
                s.filter { asleepValues.contains($0.value) }.reduce(0) { $0 + $1.endDate.timeIntervalSince($1.startDate) / 60 }
            }
            guard let best = bySource.values.max(by: { asleepMinutes($0) < asleepMinutes($1) }),
                  asleepMinutes(best) > 0 else {
                return call.resolve(["sleep": NSNull()])
            }
            var minutes: [Int: Double] = [:]
            for s in best {
                minutes[s.value, default: 0] += s.endDate.timeIntervalSince(s.startDate) / 60
            }
            let sorted = best.sorted { $0.startDate < $1.startDate }
            let asleep = sorted.filter { asleepValues.contains($0.value) }
            let bed = sorted.first?.startDate ?? Date()
            let wake = sorted.map { $0.endDate }.max() ?? bed
            // An awakening is an "awake" stretch between two asleep stretches.
            let awakenings = sorted.filter { s in
                s.value == 2 && asleep.contains { $0.endDate <= s.startDate } && asleep.contains { $0.startDate >= s.endDate }
            }.count
            let sleepMinutes = asleepMinutes(best)
            call.resolve(["sleep": [
                "bedtime": self.iso(bed),
                "wakeTime": self.iso(wake),
                "sleepMinutes": Int(sleepMinutes.rounded()),
                "timeInBedMinutes": Int((wake.timeIntervalSince(bed) / 60).rounded()),
                "lightMinutes": Int((minutes[3] ?? 0).rounded()),
                "deepMinutes": Int((minutes[4] ?? 0).rounded()),
                "remMinutes": Int((minutes[5] ?? 0).rounded()),
                "awakeMinutes": Int((minutes[2] ?? 0).rounded()),
                "awakenings": awakenings
            ]])
        }
    }

    /// { workouts: [{ id, startTime, endTime, activityType, durationMinutes,
    ///   distanceKm, calories, sourceName, fromThisApp }] }
    @objc func getWorkouts(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let range = dayRange(call) else { return call.reject("start and end (YYYY-MM-DD) are required") }
        let start = range.start, end = range.end
        samples(HKObjectType.workoutType(), start: start, end: end) { [weak self] all in
            guard let self = self else { return }
            let energy = self.quantity(.activeEnergyBurned)
            let rows: [[String: Any]] = all.compactMap { $0 as? HKWorkout }.map { w in
                var kcal: Double = 0
                if #available(iOS 16.0, *), let energy = energy {
                    kcal = w.statistics(for: energy)?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
                } else {
                    kcal = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                }
                return [
                    "id": w.uuid.uuidString,
                    "startTime": self.iso(w.startDate),
                    "endTime": self.iso(w.endDate),
                    "date": self.dayKey(w.startDate),
                    "activityType": Int(w.workoutActivityType.rawValue),
                    "durationMinutes": Int((w.duration / 60).rounded()),
                    "distanceKm": (w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo))) ?? 0,
                    "calories": Int(kcal.rounded()),
                    "sourceName": w.sourceRevision.source.name,
                    "fromThisApp": self.isFromThisApp(w)
                ]
            }
            call.resolve(["workouts": rows])
        }
    }

    // MARK: - Food

    /// Totals for { start, end } (epoch ms): { energyKcal, protein, carbs, fat, sources }.
    /// Sources are the names of the apps that logged food in that range.
    @objc func getNutritionTotals(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let s = call.getDouble("start"), let e = call.getDouble("end") else {
            return call.reject("start and end (epoch ms) are required")
        }
        let start = Date(timeIntervalSince1970: s / 1000)
        let end = Date(timeIntervalSince1970: e / 1000)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let parts: [(String, HKQuantityTypeIdentifier, HKUnit)] = [
            ("energyKcal", .dietaryEnergyConsumed, .kilocalorie()),
            ("protein", .dietaryProtein, .gram()),
            ("carbs", .dietaryCarbohydrates, .gram()),
            ("fat", .dietaryFatTotal, .gram())
        ]
        let group = DispatchGroup()
        let lock = NSLock()
        var out: [String: Any] = [:]
        var sources = Set<String>()
        for (key, id, unit) in parts {
            guard let type = quantity(id) else { continue }
            group.enter()
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate,
                                      options: [.cumulativeSum, .separateBySource]) { _, stats, _ in
                var total: Double = 0
                var names: [String] = []
                // Summing per source and skipping our own avoids counting food
                // the app itself wrote (it doesn't today, but stay safe).
                for source in stats?.sources ?? [] where source.bundleIdentifier != Bundle.main.bundleIdentifier {
                    if let v = stats?.sumQuantity(for: source)?.doubleValue(for: unit), v > 0 {
                        total += v
                        names.append(source.name)
                    }
                }
                lock.lock()
                out[key] = total
                names.forEach { sources.insert($0) }
                lock.unlock()
                group.leave()
            }
            store.execute(q)
        }
        group.notify(queue: .global()) {
            out["sources"] = Array(sources).sorted()
            call.resolve(out)
        }
    }

    // MARK: - Writing

    /// Saves a lifting session: { id, start, end (epoch ms), kcal?, title? }.
    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let s = call.getDouble("start"), let e = call.getDouble("end"), e > s else {
            return call.reject("start and end (epoch ms) are required")
        }
        let start = Date(timeIntervalSince1970: s / 1000)
        let end = Date(timeIntervalSince1970: e / 1000)
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        var metadata: [String: Any] = [HKMetadataKeyIndoorWorkout: true]
        if let id = call.getString("id") { metadata[HKMetadataKeyExternalUUID] = id }
        if let title = call.getString("title"), !title.isEmpty { metadata["PocketCoachTitle"] = title }

        builder.beginCollection(withStart: start) { [weak self] ok, error in
            guard let self = self, ok else {
                return call.reject(error?.localizedDescription ?? "Could not start the workout", "SAVE_FAILED")
            }
            let finish = {
                builder.addMetadata(metadata) { _, _ in
                    builder.endCollection(withEnd: end) { _, _ in
                        builder.finishWorkout { workout, error in
                            if let workout = workout {
                                call.resolve(["id": workout.uuid.uuidString])
                            } else {
                                call.reject(error?.localizedDescription ?? "Could not save the workout", "SAVE_FAILED")
                            }
                        }
                    }
                }
            }
            if let kcal = call.getDouble("kcal"), kcal > 0, let type = self.quantity(.activeEnergyBurned) {
                let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                                              start: start, end: end)
                builder.add([sample]) { _, _ in finish() }
            } else {
                finish()
            }
        }
    }

    /// Saves a bodyweight reading: { kg, date (epoch ms) }.
    @objc func saveBodyMass(_ call: CAPPluginCall) {
        guard guardAvailable(call) else { return }
        guard let kg = call.getDouble("kg"), kg > 0, let type = quantity(.bodyMass) else {
            return call.reject("kg is required")
        }
        let when = call.getDouble("date").map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg),
                                      start: when, end: when)
        store.save(sample) { ok, error in
            if ok { call.resolve() } else { call.reject(error?.localizedDescription ?? "Could not save", "SAVE_FAILED") }
        }
    }
}
