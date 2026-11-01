# Adds the Liquid Glass app icon (Icon Composer .icon file) to the
# generated iOS project.
#
# Codemagic regenerates ios/ on every build, so this copies
# native/ios/AppIcon.icon into the App target as a resource. Xcode 26
# compiles it into the iOS 26 Liquid Glass icon (light, dark, tinted and
# clear) and also renders the flat icons for older iOS versions and the
# App Store. The AppIcon set @capacitor/assets writes into Assets.xcassets
# has the same name and is ignored once this file is present. Run from the
# repo root after the icon/splash step; running it twice is harmless.
#
#   ruby scripts/ios/add-app-icon.rb
#
# The .icon file is plain JSON + SVG: native/ios/AppIcon.icon/icon.json sets
# the background gradient and the glass groups (listed front to back),
# Assets/ holds the layer artwork. It also opens in Icon Composer on a Mac.

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
ICON_NAME = 'AppIcon'
SOURCE = File.join(ROOT, 'native', 'ios', "#{ICON_NAME}.icon")
DEST = File.join(APP_DIR, 'App', "#{ICON_NAME}.icon")

abort "No Xcode project at #{PROJECT_PATH} - run `npx cap add ios` first" unless File.directory?(PROJECT_PATH)
abort "Missing #{SOURCE}" unless File.file?(File.join(SOURCE, 'icon.json'))

FileUtils.rm_rf(DEST)
FileUtils.cp_r(SOURCE, DEST)

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == 'App' } or abort 'No "App" target in the project'
group = project.main_group.find_subpath('App', false) or abort 'No "App" group in the project'

ref = group.files.find { |f| f.path == "#{ICON_NAME}.icon" }
unless ref
  ref = group.new_reference("#{ICON_NAME}.icon")
  ref.last_known_file_type = 'folder.iconcomposer.icon'
end
unless app.resources_build_phase.files_references.include?(ref)
  app.resources_build_phase.add_file_reference(ref, true)
end

# The .icon file's name (without extension) is what the build setting names.
app.build_configurations.each do |config|
  config.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = ICON_NAME
end

project.save
puts "Added #{ICON_NAME}.icon to the App target"
