# Adds the Live Activity widget extension to the generated iOS project.
#
# The iOS project isn't committed: Codemagic runs `npx cap add ios` on every
# build. `cap sync` can add plugins but not an app extension, so this script
# adds the PocketCoachLiveActivity target with the xcodeproj gem (it ships
# with CocoaPods on Codemagic's Macs). Run from the repo root after
# `cap add ios`; running it twice is harmless.
#
#   ruby scripts/ios/add-live-activity.rb
#
# Sources: native/ios/PocketCoachLiveActivity (widget UI + Info.plist) and
# the files shared with plugins/workout-activity: WorkoutActivityAttributes.swift
# (Live Activity) and TodayWidgetStore.swift (Home Screen "Today" widget).
#
# The Today widget reads what the app writes into an App Group, so this also
# gives the extension that App Group (entitlements + PocketCoachAppGroup in its
# Info.plist). add-capabilities.rb does the same for the app.

begin
  require 'xcodeproj'
rescue LoadError
  Gem.install('xcodeproj')
  Gem.refresh
  require 'xcodeproj'
end
require 'fileutils'

ROOT = File.expand_path('../..', __dir__)
APP_DIR = File.join(ROOT, 'ios', 'App')
PROJECT_PATH = File.join(APP_DIR, 'App.xcodeproj')
EXT_NAME = 'PocketCoachLiveActivity'
EXT_DIR = File.join(APP_DIR, EXT_NAME)
SOURCE_DIR = File.join(ROOT, 'native', 'ios', EXT_NAME)
PLUGIN_SOURCES = File.join(ROOT, 'plugins', 'workout-activity', 'ios', 'Sources', 'WorkoutActivityPlugin')
SHARED_SOURCES = %w[WorkoutActivityAttributes.swift TodayWidgetStore.swift].map { |f| File.join(PLUGIN_SOURCES, f) }
APP_BUNDLE_ID = ENV.fetch('BUNDLE_ID', 'org.pocketcoachcoms.app')
EXT_BUNDLE_ID = "#{APP_BUNDLE_ID}.LiveActivity"
APP_GROUP = "group.#{APP_BUNDLE_ID}"
ENTITLEMENTS_FILE = "#{EXT_NAME}.entitlements"
# Activity.request(attributes:content:pushType:) needs iOS 16.2.
DEPLOYMENT_TARGET = '16.2'

abort "No Xcode project at #{PROJECT_PATH} - run `npx cap add ios` first" unless File.directory?(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == 'App' } or abort 'No "App" target in the project'

if project.targets.any? { |t| t.name == EXT_NAME }
  puts "#{EXT_NAME} is already in the project"
  exit 0
end

# 1. Copy the sources next to the app so the project references stay relative.
FileUtils.rm_rf(EXT_DIR)
FileUtils.mkdir_p(EXT_DIR)
FileUtils.cp(Dir[File.join(SOURCE_DIR, '*')], EXT_DIR)
SHARED_SOURCES.each { |f| FileUtils.cp(f, EXT_DIR) }

# The App Group the Today widget reads (TodayWidgetStore.groupId).
info_path = File.join(EXT_DIR, 'Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info['PocketCoachAppGroup'] = APP_GROUP
Xcodeproj::Plist.write_to_path(info, info_path)

File.write(File.join(EXT_DIR, ENTITLEMENTS_FILE), <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  \t<key>com.apple.security.application-groups</key>
  \t<array><string>#{APP_GROUP}</string></array>
  </dict>
  </plist>
PLIST

# 2. The extension target.
ext = project.new_target(:app_extension, EXT_NAME, :ios, DEPLOYMENT_TARGET, nil, :swift)

group = project.main_group.find_subpath(EXT_NAME, true)
group.set_source_tree('<group>')
group.set_path(EXT_NAME)
Dir[File.join(EXT_DIR, '*.swift')].sort.each do |path|
  ext.source_build_phase.add_file_reference(group.new_reference(File.basename(path)))
end
group.new_reference('Info.plist')
group.new_reference(ENTITLEMENTS_FILE)

# Signing team and versions follow the app target, so the extension is
# signed the same way and its version matches (App Store Connect rejects a
# mismatch).
app_settings = app.build_configurations.each_with_object({}) { |c, h| h[c.name] = c.build_settings }

ext.build_configurations.each do |config|
  s = config.build_settings
  from_app = app_settings[config.name] || {}
  s['PRODUCT_BUNDLE_IDENTIFIER'] = EXT_BUNDLE_ID
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = "#{EXT_NAME}/Info.plist"
  s['CODE_SIGN_ENTITLEMENTS'] = "#{EXT_NAME}/#{ENTITLEMENTS_FILE}"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['VERSIONING_SYSTEM'] = 'apple-generic'
  s['MARKETING_VERSION'] = from_app['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = from_app['CURRENT_PROJECT_VERSION'] || '1'
  %w[CODE_SIGN_STYLE DEVELOPMENT_TEAM CODE_SIGN_IDENTITY].each do |key|
    s[key] = from_app[key] if from_app[key]
  end
end

# 3. Build it with the app and embed it in App.app/PlugIns.
app.add_dependency(ext)
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Added #{EXT_NAME} (#{EXT_BUNDLE_ID}) to #{PROJECT_PATH}"
