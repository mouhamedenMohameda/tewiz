module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'react' }],
    ],
    plugins: [
      // Reanimated 4.x moved its babel plugin to react-native-worklets.
      // Must be the LAST plugin.
      'react-native-worklets/plugin',
    ],
  };
};
