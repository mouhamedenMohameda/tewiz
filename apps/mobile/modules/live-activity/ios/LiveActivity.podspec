Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Ride Live Activity (ActivityKit) bridge'
  s.description    = 'iOS-only Expo module that starts / updates / ends the active-ride Live Activity.'
  s.author         = 'Tewiz'
  s.homepage       = 'https://tewiz.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Picks up LiveActivityModule.swift in this directory. The ActivityKit calls
  # inside are guarded with `if #available(iOS 16.2, *)`, so a 15.1 deployment
  # target compiles fine.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
