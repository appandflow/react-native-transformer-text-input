#import "TransformerTextInputDecoratorView.h"

#import <React/RCTBackedTextInputDelegate.h>
#import <React/RCTBackedTextInputViewProtocol.h>
#import <React/RCTConversions.h>
#import <React/RCTTextInputComponentView.h>
#import <react/renderer/components/rntti/EventEmitters.h>
#import <react/renderer/components/rntti/Props.h>
#import <react/renderer/components/rntti/RCTComponentViewHelpers.h>
#import "TransformerTextInputDecoratorViewComponentDescriptor.h"
#import "TransformerTextInputRuntime.h"

using namespace facebook::react;

struct RNTTITextState {
  NSString *value;
  NSRange selection;
};

@interface TransformerTextInputDecoratorView () <
    RCTTransformerTextInputDecoratorViewViewProtocol,
    RCTBackedTextInputDelegate>

@end

@implementation TransformerTextInputDecoratorView {
  std::optional<jsi::WeakObject> _transformer;
  bool _observersAdded;
  __weak id<RCTBackedTextInputDelegate> _baseDelegate;
  __weak UIView<RCTBackedTextInputViewProtocol> *_backedTextInput;
  NSString *_lastKnownValue;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<TransformerTextInputDecoratorViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = TransformerTextInputDecoratorViewShadowNode::defaultSharedProps();
    _observersAdded = false;
  }

  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<TransformerTextInputDecoratorViewProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<TransformerTextInputDecoratorViewProps const>(props);

  bool transformerIdChanged = oldViewProps.transformerId != newViewProps.transformerId;
  if (transformerIdChanged) {
    _transformer = rntti::LookupTransformer(newViewProps.transformerId);
  }

  [super updateProps:props oldProps:oldProps];

  // When the transformer is swapped after mount, re-run it on the current
  // text so the displayed value reformats immediately. On the initial prop
  // set, seed the transformer's previous value and selection instead.
  if (transformerIdChanged && _backedTextInput != nil) {
    if (oldViewProps.transformerId != 0) {
      [self reapplyTransformer];
    } else {
      [self syncTransformerHistory];
    }
  }
}

- (void)reapplyTransformer
{
  NSString *currentValue = [self currentValue];
  NSRange currentSelection = [self currentSelection];
  RNTTITextState current{currentValue, currentSelection};
  RNTTITextState next = [self transformTextState:current transform:YES];
  bool didTransformValue = ![next.value isEqualToString:currentValue];
  if (!didTransformValue && NSEqualRanges(next.selection, currentSelection)) {
    return;
  }
  if (didTransformValue) {
    [self applyValue:next.value];
  }
  [self applySelection:next.selection];
  _lastKnownValue = next.value;
  if (didTransformValue) {
    [_baseDelegate textInputDidChange];
  }
}

- (void)syncTransformerHistory
{
  if (!_backedTextInput || !_transformer) {
    return;
  }
  NSString *currentValue = [self currentValue];
  NSRange currentSelection = [self currentSelection];
  RNTTITextState current{currentValue, currentSelection};
  [self transformTextState:current transform:NO];
  _lastKnownValue = currentValue;
}

- (void)applyValue:(NSString *)newValue
{
  NSMutableAttributedString *newAttributedText =
      [[NSMutableAttributedString alloc] initWithAttributedString:_backedTextInput.attributedText];

  [newAttributedText replaceCharactersInRange:NSMakeRange(0, newAttributedText.length) withString:newValue];
  _backedTextInput.attributedText = newAttributedText;
}

- (NSRange)currentSelection
{
  UITextRange *selectedTextRange = _backedTextInput.selectedTextRange;
  if (!selectedTextRange) {
    return NSMakeRange(0, 0);
  }
  NSInteger start = [_backedTextInput offsetFromPosition:_backedTextInput.beginningOfDocument
                                              toPosition:selectedTextRange.start];
  NSInteger end = [_backedTextInput offsetFromPosition:_backedTextInput.beginningOfDocument
                                            toPosition:selectedTextRange.end];
  return NSMakeRange(start, end - start);
}

- (NSString *)currentValue
{
  return _backedTextInput.attributedText.string ?: @"";
}

- (void)applySelection:(NSRange)selection
{
  UITextPosition *startPosition = [_backedTextInput positionFromPosition:_backedTextInput.beginningOfDocument
                                                                  offset:selection.location];
  UITextPosition *endPosition = [_backedTextInput positionFromPosition:_backedTextInput.beginningOfDocument
                                                                offset:selection.location + selection.length];
  if (!startPosition || !endPosition) {
    return;
  }
  UITextRange *range = [_backedTextInput textRangeFromPosition:startPosition toPosition:endPosition];
  if (range) {
    [_backedTextInput setSelectedTextRange:range notifyDelegate:NO];
  }
}

- (RNTTITextState)transformTextState:(RNTTITextState)state transform:(BOOL)transform
{
  if (!_transformer) {
    return state;
  }

  rntti::SelectionRange selectionRange{
      static_cast<int>(state.selection.location), static_cast<int>(state.selection.location + state.selection.length)};
  auto transformResult =
      rntti::RunTransformer(_transformer, RCTStringFromNSString(state.value), selectionRange, transform);
  if (!transformResult) {
    return state;
  }

  NSString *value = RCTNSStringFromString(transformResult->value);
  NSRange selection =
      NSMakeRange(transformResult->selection.start, transformResult->selection.end - transformResult->selection.start);

  return RNTTITextState{value, selection};
}

- (void)didAddSubview:(UIView *)subview
{
  [super didAddSubview:subview];

  [self addTextInputObservers];
}

- (void)willRemoveSubview:(UIView *)subview
{
  [super willRemoveSubview:subview];

  [self removeTextInputObservers];
}

- (void)addTextInputObservers
{
  react_native_assert(
      !_observersAdded &&
      "MarkdownTextInputDecoratorComponentView tried to add TextInput observers while they were attached");
  react_native_assert(
      self.subviews.count > 0 && "MarkdownTextInputDecoratorComponentView is mounted without any children");
  UIView *childView = self.subviews[0];
  react_native_assert(
      [childView isKindOfClass:[RCTTextInputComponentView class]] &&
      "Child component of MarkdownTextInputDecoratorComponentView is not an instance of RCTTextInputComponentView.");
  RCTTextInputComponentView *textInputComponentView = (RCTTextInputComponentView *)childView;
  UIView<RCTBackedTextInputViewProtocol> *backedTextInputView =
      [textInputComponentView valueForKey:@"_backedTextInputView"];

  _backedTextInput = backedTextInputView;
  id<RCTBackedTextInputDelegate> currentDelegate = backedTextInputView.textInputDelegate;
  // Guard against setting ourselves as baseDelegate (would cause infinite recursion)
  if (currentDelegate != self) {
    _baseDelegate = currentDelegate;
  }
  backedTextInputView.textInputDelegate = self;

  _observersAdded = true;
  [self syncTransformerHistory];
}

- (void)removeTextInputObservers
{
  if (_backedTextInput && _baseDelegate) {
    _backedTextInput.textInputDelegate = _baseDelegate;
  }
  _backedTextInput = nil;
  _baseDelegate = nil;
  _observersAdded = false;
  _transformer = std::nullopt;
  _lastKnownValue = nil;
}

- (void)textInputDidBeginEditing
{
  [_baseDelegate textInputDidBeginEditing];
}

- (void)textInputDidChange
{
  // Current values
  NSString *currentValue = [self currentValue];
  NSRange currentSelection = [self currentSelection];
  RNTTITextState current{currentValue, currentSelection};
  RNTTITextState next = [self transformTextState:current transform:YES];
  bool didTransformValue = ![next.value isEqualToString:current.value];
  if (didTransformValue) {
    [self applyValue:next.value];
  }
  if (didTransformValue || !NSEqualRanges(next.selection, current.selection)) {
    [self applySelection:next.selection];
  }
  _lastKnownValue = next.value;

  [_baseDelegate textInputDidChange];
}

- (void)textInputDidChangeSelection
{
  NSString *currentValue = [self currentValue];
  // Selection callbacks can arrive before text-change callbacks for an edit.
  // Only sync when the text itself is unchanged so the edit still receives
  // the state from before the user typed.
  if (_lastKnownValue == nil || [currentValue isEqualToString:_lastKnownValue]) {
    [self syncTransformerHistory];
  }
  [_baseDelegate textInputDidChangeSelection];
}

- (void)textInputDidEndEditing
{
  [_baseDelegate textInputDidEndEditing];
}

- (void)textInputDidReturn
{
  [_baseDelegate textInputDidReturn];
}

- (BOOL)textInputShouldBeginEditing
{
  id<RCTBackedTextInputDelegate> delegate = _baseDelegate;
  if (delegate == nil || delegate == self) {
    return YES;
  }
  return [delegate textInputShouldBeginEditing];
}

- (nonnull NSString *)textInputShouldChangeText:(nonnull NSString *)text inRange:(NSRange)range
{
  return [_baseDelegate textInputShouldChangeText:text inRange:range];
}

- (BOOL)textInputShouldEndEditing
{
  return [_baseDelegate textInputShouldEndEditing];
}

- (BOOL)textInputShouldReturn
{
  return [_baseDelegate textInputShouldReturn];
}

- (BOOL)textInputShouldSubmitOnReturn
{
  return [_baseDelegate textInputShouldSubmitOnReturn];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTTransformerTextInputDecoratorViewHandleCommand(self, commandName, args);
}

- (void)update:(BOOL)transform
             value:(NSString *)value
    selectionStart:(NSInteger)selectionStart
      selectionEnd:(NSInteger)selectionEnd
{
  NSString *currentValue = [self currentValue];
  NSRange currentSelection = [self currentSelection];
  NSString *providedValue = value ?: currentValue;
  NSRange providedSelection = NSMakeRange(selectionStart, selectionEnd - selectionStart);
  RNTTITextState provided{providedValue, providedSelection};
  RNTTITextState next = [self transformTextState:provided transform:transform];
  bool didTransformValue = ![next.value isEqualToString:currentValue];
  if (didTransformValue) {
    [self applyValue:next.value];
  }
  if (didTransformValue || !NSEqualRanges(next.selection, currentSelection)) {
    [self applySelection:next.selection];
  }
  _lastKnownValue = next.value;

  [_baseDelegate textInputDidChange];
}

@end
