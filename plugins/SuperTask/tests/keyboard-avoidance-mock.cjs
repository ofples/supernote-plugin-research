const React = require('react');

module.exports = {
  KeyboardAwareScrollView: ({children, ...props}) => React.createElement('ScrollView', {
    ...props,
    keyboardShouldPersistTaps: props.keyboardShouldPersistTaps || 'handled',
  }, children),
  KeyboardAvoidanceViewport: ({children, ...props}) => React.createElement('View', props, children),
  KeyboardAwareTextInput: props => React.createElement('Input', props),
};
