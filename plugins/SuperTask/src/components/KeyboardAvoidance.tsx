import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

type KeyboardFrame = {screenY: number; height?: number};
type ViewportFrame = {top: number; height: number};
type FocusedInputFrame = {top: number; height: number};

/** Return only the part of a keyboard that covers this window's bottom edge. */
export function calculateKeyboardInset(viewport: ViewportFrame, keyboard: KeyboardFrame | null): number {
  if (!keyboard || !Number.isFinite(viewport.top) || !Number.isFinite(viewport.height) || !Number.isFinite(keyboard.screenY)) return 0;
  return Math.max(0, Math.min(viewport.height, viewport.top + viewport.height - keyboard.screenY));
}

/** Correct RN 0.79 Android frames that report the full screen bottom as IME top. */
export function normalizeKeyboardFrame(frame: KeyboardFrame | null, screenHeight: number): KeyboardFrame | null {
  if (!frame || !Number.isFinite(frame.screenY) || !Number.isFinite(frame.height) || frame.height! <= 0 || !Number.isFinite(screenHeight) || screenHeight <= 0) return frame;
  // ReactRootView compares softInputMode to ADJUST_NOTHING without masking the
  // state bits. PluginHost uses STATE_ALWAYS_HIDDEN | ADJUST_NOTHING, so it can
  // report the full display bottom plus a positive keyboard height. A resized
  // window reports screenY at the keyboard top and its bottom remains in range.
  if (frame.screenY + frame.height! > screenHeight + 2) {
    return {...frame, screenY: Math.max(0, screenHeight - frame.height!)};
  }
  return frame;
}

function currentKeyboardFrame(frame: KeyboardFrame | null): KeyboardFrame | null {
  return normalizeKeyboardFrame(frame, Dimensions.get('screen').height);
}

/** Move only enough to expose a focused field inside the part of the scroll view above the keyboard. */
export function calculateFocusedInputScrollDelta(
  viewport: ViewportFrame & {scrollY: number},
  input: FocusedInputFrame,
  keyboard: KeyboardFrame | null,
  gap = 16,
): number {
  const visibleTop = viewport.top;
  const visibleBottom = Math.min(viewport.top + viewport.height, keyboard?.screenY ?? Number.POSITIVE_INFINITY);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  if (visibleHeight === 0 || !Number.isFinite(input.top) || !Number.isFinite(input.height)) return 0;

  // A multiline field can be taller than the usable viewport. Keep its lower
  // edge (where the insertion point usually is) visible while it is edited.
  if (input.height + gap * 2 > visibleHeight) {
    return input.top + input.height - (visibleBottom - gap);
  }
  if (input.top < visibleTop + gap) return input.top - (visibleTop + gap);
  if (input.top + input.height > visibleBottom - gap) return input.top + input.height - (visibleBottom - gap);
  return 0;
}

/**
 * Resolve an absolute scroll offset from the input's stable position inside
 * ScrollView content. Screen-space input bounds decide whether it is already
 * visible; this avoids relying on an onScroll event that may lag native focus
 * scrolling on the plugin host.
 */
export function calculateFocusedInputScrollTarget(
  viewport: ViewportFrame,
  inputScreen: FocusedInputFrame,
  inputContentTop: number,
  keyboard: KeyboardFrame | null,
  gap = 16,
  inputContentHeight = inputScreen.height,
): number | null {
  const visibleTop = viewport.top;
  const visibleBottom = Math.min(viewport.top + viewport.height, keyboard?.screenY ?? Number.POSITIVE_INFINITY);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  if (visibleHeight === 0 || !Number.isFinite(inputScreen.top) || !Number.isFinite(inputScreen.height) || !Number.isFinite(inputContentTop)) return null;
  const inputBottom = inputScreen.top + inputScreen.height;
  const contentHeight = Number.isFinite(inputContentHeight) && inputContentHeight > 0 ? inputContentHeight : inputScreen.height;
  const tooTall = contentHeight + gap * 2 > visibleHeight;
  if (inputScreen.height > 0 && !tooTall && inputScreen.top >= visibleTop + gap && inputBottom <= visibleBottom - gap) return null;

  const target = inputScreen.top < visibleTop + gap && !tooTall
    ? inputContentTop - gap
    : inputContentTop + contentHeight - visibleHeight + gap;
  return Math.max(0, target);
}

/** Subscribe to the events that change the visible keyboard frame. */
export function subscribeToKeyboardFrames(
  keyboard: typeof Keyboard,
  dimensions: typeof Dimensions,
  onShow: (frame: KeyboardFrame) => void,
  onHide: () => void,
  onWindowChange: () => void,
): () => void {
  const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  const show = keyboard.addListener(showEvent, event => onShow(event.endCoordinates));
  const hide = keyboard.addListener(hideEvent, onHide);
  const resize = dimensions.addEventListener('change', onWindowChange);
  return () => {
    show.remove();
    hide.remove();
    resize.remove();
  };
}

type KeyboardAvoidanceViewportProps = React.PropsWithChildren<{
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  accessibilityLabel?: string;
}>;

/** Shrinks to the visible area above the keyboard, accounting for host-window offsets and adjustResize. */
export function KeyboardAvoidanceViewport({children, style, contentStyle, accessibilityLabel}: KeyboardAvoidanceViewportProps) {
  const frameRef = useRef<ViewportFrame>({top: 0, height: 0});
  const windowRef = useRef<View>(null);
  const mounted = useRef(true);
  const [frame, setFrame] = useState<ViewportFrame>(frameRef.current);
  const [keyboard, setKeyboard] = useState<KeyboardFrame | null>(() => currentKeyboardFrame(Keyboard.metrics() || null));

  const measureTop = useCallback(() => {
    if (!mounted.current) return;
    windowRef.current?.measureInWindow((_x, top) => {
      if (!mounted.current) return;
      const next = {...frameRef.current, top};
      frameRef.current = next;
      setFrame(next);
    });
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = {...frameRef.current, height: event.nativeEvent.layout.height};
    frameRef.current = next;
    setFrame(next);
    measureTop();
  }, [measureTop]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeToKeyboardFrames(
      Keyboard,
      Dimensions,
      next => {setKeyboard(currentKeyboardFrame(next)); measureTop();},
      () => setKeyboard(null),
      () => {
        const metrics = Keyboard.metrics();
        setKeyboard(currentKeyboardFrame(metrics || null));
        measureTop();
      },
    );
    return () => {mounted.current = false; unsubscribe();};
  }, [measureTop]);

  const inset = calculateKeyboardInset(frame, keyboard);
  return <View ref={windowRef} onLayout={onLayout} accessibilityLabel={accessibilityLabel} style={[{flex: 1, overflow: 'hidden'}, style]}>
    <View style={[{flex: 1}, contentStyle, inset > 0 && {height: Math.max(0, frame.height - inset), flex: 0}]}>
      {children}
    </View>
  </View>;
}

export function focusedInputTarget(event: any): number | null {
  const target = event?.nativeEvent?.target ?? event?.target;
  return typeof target === 'number' ? target : null;
}

export function revealFocusedInput(
  scrollView: {scrollTo?: (options: {y: number; animated: boolean}) => void},
  currentOffset: number,
  viewport: ViewportFrame,
  input: FocusedInputFrame,
  keyboard: KeyboardFrame | null,
): number {
  const delta = calculateFocusedInputScrollDelta({...viewport, scrollY: currentOffset}, input, keyboard);
  if (Math.abs(delta) > 1) scrollView.scrollTo?.({y: Math.max(0, currentOffset + delta), animated: false});
  return delta;
}

type KeyboardInput = React.ElementRef<typeof TextInput>;
type KeyboardScrollOwner = {
  focus: (input: KeyboardInput | null) => void;
  blur: (input: KeyboardInput | null) => void;
};
const KeyboardScrollContext = React.createContext<KeyboardScrollOwner | null>(null);

/** Text inputs register their host instance with the nearest vertical form scroller. */
export const KeyboardAwareTextInput = React.forwardRef<KeyboardInput, TextInputProps>(function KeyboardAwareTextInput({onFocus, onBlur, ...props}, forwardedRef) {
  const owner = React.useContext(KeyboardScrollContext);
  const inputRef = useRef<KeyboardInput>(null);
  const setRef = useCallback((input: KeyboardInput | null) => {
    if (input == null && inputRef.current) owner?.blur(inputRef.current);
    inputRef.current = input;
    if (typeof forwardedRef === 'function') forwardedRef(input);
    else if (forwardedRef) forwardedRef.current = input;
  }, [forwardedRef, owner]);
  return <TextInput {...props} ref={setRef}
    onFocus={event => {owner?.focus(inputRef.current); onFocus?.(event);}}
    onBlur={event => {owner?.blur(inputRef.current); onBlur?.(event);}} />;
});

/** Vertical form lists explicitly reveal their focused input when the keyboard opens. */
export function KeyboardAwareScrollView({keyboardShouldPersistTaps = 'handled', children, ...props}: ScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const focusedInput = useRef<KeyboardInput | null>(null);
  const mounted = useRef(true);
  const viewportRef = useRef<ViewportFrame>({top: 0, height: 0});
  const currentOffset = useRef(0);
  const keyboardFrame = useRef<KeyboardFrame | null>(currentKeyboardFrame(Keyboard.metrics() || null));
  const measure = useCallback(() => {
    if (!mounted.current) return;
    const view = scrollRef.current as any;
    const input = focusedInput.current;
    if (!input?.measureInWindow || !view?.measureInWindow) return;
    view.measureInWindow((_x: number, top: number, width: number, height: number) => {
      // Inactive navigation routes stay mounted with display:none. Their
      // native frames are empty, so don't let a keyboard event scroll them.
      if (!mounted.current || width <= 0 || height <= 0) return;
      viewportRef.current = {top, height};
      input.measureInWindow((_inputX: number, inputTop: number, _inputWidth: number, inputHeight: number) => {
        if (!mounted.current || focusedInput.current !== input) return;
        const frame = {top: inputTop, height: inputHeight};
        const innerView = view.getInnerViewRef?.();
        if (innerView && typeof input.measureLayout === 'function') {
          // Measure relative to ScrollView's content container. scrollTo takes
          // an absolute content offset, so no asynchronous JS onScroll state is
          // needed to correct a native focus scroll that raced this callback.
          const fallback = () => {
            if (!mounted.current || focusedInput.current !== input) return;
            // Some host wrappers may not expose relative layout measurement.
            // Preserve the screen-space fallback for those implementations.
            revealFocusedInput(view, currentOffset.current, viewportRef.current, frame, keyboardFrame.current);
          };
          try {
            input.measureLayout(innerView, (_contentX: number, contentTop: number, _contentWidth: number, contentHeight: number) => {
              if (!mounted.current || focusedInput.current !== input) return;
              const target = calculateFocusedInputScrollTarget(viewportRef.current, frame, contentTop, keyboardFrame.current, 16, contentHeight);
              if (target != null) view.scrollTo?.({y: target, animated: false});
            }, fallback);
          } catch {
            fallback();
          }
          return;
        }
        revealFocusedInput(view, currentOffset.current, viewportRef.current, frame, keyboardFrame.current);
      });
    });
  }, []);
  const focus = useCallback((input: KeyboardInput | null) => {
    focusedInput.current = input;
    if (Keyboard.isVisible()) requestAnimationFrame(() => measure());
  }, [measure]);
  const blur = useCallback((input: KeyboardInput | null) => {
    if (input == null || focusedInput.current === input) focusedInput.current = null;
  }, []);
  const owner = React.useMemo(() => ({focus, blur}), [focus, blur]);

  useEffect(() => {
    mounted.current = true;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, event => {
      keyboardFrame.current = currentKeyboardFrame(event.endCoordinates);
      requestAnimationFrame(() => measure());
    });
    const hidden = Keyboard.addListener(hideEvent, () => {keyboardFrame.current = null;});
    const resize = Dimensions.addEventListener('change', () => {
      keyboardFrame.current = currentKeyboardFrame(Keyboard.metrics() || null);
      requestAnimationFrame(() => measure());
    });
    return () => {mounted.current = false; shown.remove(); hidden.remove(); resize.remove();};
  }, [measure]);

  return <KeyboardScrollContext.Provider value={owner}>
    <ScrollView
      {...props}
      ref={scrollRef}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onLayout={(event: LayoutChangeEvent) => {
        viewportRef.current = {...viewportRef.current, height: event.nativeEvent.layout.height};
        props.onLayout?.(event);
        requestAnimationFrame(() => measure());
      }}
      onScroll={(event: any) => {
        currentOffset.current = event.nativeEvent.contentOffset.y;
        props.onScroll?.(event);
      }}
      onContentSizeChange={(width: number, height: number) => {
        props.onContentSizeChange?.(width, height);
        if (keyboardFrame.current) requestAnimationFrame(() => measure());
      }}
      scrollEventThrottle={props.scrollEventThrottle ?? 16}
    >{children}</ScrollView>
  </KeyboardScrollContext.Provider>;
}
