# Turns on the app's iOS capabilities in the generated Xcode project.
#
# The iOS project isn't committed: Codemagic runs `npx cap add ios` on every
# build, which gives an app with no entitlements. This script writes
# App/App.entitlements, points the App target at it, and adds the
# AppDelegate hooks the plugins need. Run from the repo root after
# `cap add ios`; running it twice is harmless.
#
#   ruby scripts/ios/add-capabilities.rb
#
# The same capabilities must be ticked on the App ID at developer.apple.com
# (Certificates, IDs & Profiles → Identifiers → com.pocketcoach.app), and the
# App Store provisioning profile fetched again after ticking them, or signing
# fails with "Provisioning profile doesn't include the ... entitlement".

begin
  require 'xcodeproj'
rescue LoadError
  Gem.install('xcodeproj')
  Gem.refresh
  require 'xcodeproj'
end

ROOT = File.expand_path('../..', __dir__)
APP_DIR = File.join(ROOT, 'ios', 'App')
PROJECT_PATH = File.join(APP_DIR, 'App.xcodeproj')
ENTITLEMENTS_REL = 'App/App.entitlements'
ENTITLEMENTS_PATH = File.join(APP_DIR, ENTITLEMENTS_REL)
APP_DELEGATE = File.join(APP_DIR, 'App', 'AppDelegate.swift')

abort "No Xcode project at #{PROJECT_PATH} - run `npx cap add ios` first" unless File.directory?(PROJECT_PATH)

# ── 1. Entitlements ─────────────────────────────────────────────────────────
# Each entry is raw plist XML for one key.
ENTITLEMENTS = {
  # Push notifications (@capacitor/push-notifications, src/js/push-notifications.js).
  # App Store and TestFlight builds always use the production APNs server.
  'aps-environment' => '<string>production</string>',
}

File.write(ENTITLEMENTS_PATH, <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  #{ENTITLEMENTS.map { |k, v| "\t<key>#{k}</key>\n\t#{v}" }.join("\n")}
  </dict>
  </plist>
PLIST

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == 'App' } or abort 'No "App" target in the project'
app.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = ENTITLEMENTS_REL
end
group = project.main_group.find_subpath('App', false)
if group && group.files.none? { |f| f.path == 'App.entitlements' }
  group.new_reference('App.entitlements')
end
project.save
puts "Entitlements: #{ENTITLEMENTS.keys.join(', ')}"

# ── 2. AppDelegate hooks ────────────────────────────────────────────────────
# @capacitor/push-notifications only hears about the device token if the
# AppDelegate forwards it.
PUSH_HOOKS = <<~SWIFT

      // Push notifications: hand the APNs device token to @capacitor/push-notifications.
      func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
          NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
      }

      func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
          NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
      }
SWIFT

source = File.read(APP_DELEGATE)
unless source.include?('capacitorDidRegisterForRemoteNotifications')
  last = source.rindex('}') or abort "Can't find the end of AppDelegate in #{APP_DELEGATE}"
  source = source[0...last].rstrip + "\n" + PUSH_HOOKS.gsub(/^/, '    ').gsub(/^ +$/, '') + "\n}\n"
  File.write(APP_DELEGATE, source)
  puts 'AppDelegate: added push notification hooks'
end
