package com.appandflow.transformertextinput

import android.content.Context
import android.text.Editable
import android.text.Selection
import android.text.SpanWatcher
import android.text.Spannable
import android.text.Spanned
import android.text.TextWatcher
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.views.view.ReactViewGroup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

class TransformerTextInputDecoratorView(
  context: Context,
) : ReactViewGroup(context),
  TextWatcher {
  private var transformerId: Int = 0
  private var lastEventValue: String? = null
  private var resetLastEventValueJob: Job? = null
  private var reactEditText: ReactEditText? = null
  private var isUpdating = false
  private var selectionSyncPosted = false

  // ReactEditText does not expose a listener for selection-only changes. Its
  // selection is represented by spans, so observe those markers directly.
  private val selectionWatcher =
    object : SpanWatcher {
      override fun onSpanAdded(
        text: Spannable?,
        what: Any?,
        start: Int,
        end: Int,
      ) {
        if (isSelectionMarker(what)) {
          scheduleSelectionHistorySync()
        }
      }

      override fun onSpanRemoved(
        text: Spannable?,
        what: Any?,
        start: Int,
        end: Int,
      ) {
        if (isSelectionMarker(what)) {
          scheduleSelectionHistorySync()
        }
      }

      override fun onSpanChanged(
        text: Spannable?,
        what: Any?,
        oldStart: Int,
        oldEnd: Int,
        newStart: Int,
        newEnd: Int,
      ) {
        if (isSelectionMarker(what)) {
          scheduleSelectionHistorySync()
        }
      }
    }

  private fun currentValue(): String = reactEditText?.text?.toString() ?: ""

  private fun currentSelection(): TextSelection {
    val input = reactEditText
    return if (input == null) {
      TextSelection(0, 0)
    } else {
      TextSelection(input.selectionStart.coerceAtLeast(0), input.selectionEnd.coerceAtLeast(0))
    }
  }

  private fun applyValue(value: String) {
    reactEditText?.setText(value)
  }

  private fun applySelection(selection: TextSelection) {
    reactEditText?.setSelection(selection.start, selection.end)
  }

  private fun transformTextState(
    state: TextState,
    transform: Boolean,
  ) = TransformerTextInputJni.transform(
    transformerId,
    state.value,
    state.selection.start,
    state.selection.end,
    transform,
  ) ?: state

  private fun isSelectionMarker(span: Any?): Boolean = span === Selection.SELECTION_START || span === Selection.SELECTION_END

  private fun attachSelectionWatcher(editable: Editable?) {
    if (editable == null || editable.getSpanStart(selectionWatcher) >= 0) {
      return
    }
    editable.setSpan(
      selectionWatcher,
      0,
      editable.length,
      Spanned.SPAN_INCLUSIVE_INCLUSIVE,
    )
  }

  private fun scheduleSelectionHistorySync() {
    if (selectionSyncPosted) {
      return
    }
    selectionSyncPosted = true
    reactEditText?.post {
      selectionSyncPosted = false
      if (!isUpdating) {
        syncTransformerHistory()
      }
    }
  }

  private fun syncTransformerHistory() {
    if (reactEditText == null || transformerId == 0) {
      return
    }
    val current = TextState(currentValue(), currentSelection())
    transformTextState(current, false)
  }

  fun setTransformerId(newTransformerId: Int) {
    val previousTransformerId = transformerId
    transformerId = newTransformerId
    lastEventValue = null
    // When the transformer is swapped after mount, re-run it on the current
    // text so the displayed value reformats immediately. On the initial prop
    // set, seed the transformer's previous value and selection instead.
    if (previousTransformerId != 0 &&
      previousTransformerId != newTransformerId &&
      reactEditText != null
    ) {
      reapplyTransformer()
    } else if (previousTransformerId == 0 && reactEditText != null) {
      scheduleSelectionHistorySync()
    }
  }

  private fun reapplyTransformer() {
    val currentValue = currentValue()
    val currentSelection = currentSelection()
    val current = TextState(currentValue, currentSelection)
    val next = transformTextState(current, true)
    if (next.value == currentValue && next.selection == currentSelection) {
      return
    }
    isUpdating = true
    try {
      if (next.value != currentValue) {
        applyValue(next.value)
      }
      applySelection(next.selection)
    } finally {
      isUpdating = false
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()

    val child = getChildAt(0)
    if (child is ReactEditText) {
      reactEditText = child
      child.addTextChangedListener(this)
      attachSelectionWatcher(child.text)
      child.post { syncTransformerHistory() }
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    reactEditText?.text?.removeSpan(selectionWatcher)
    reactEditText?.removeTextChangedListener(this)
    selectionSyncPosted = false
    reactEditText = null
  }

  override fun beforeTextChanged(
    s: CharSequence?,
    start: Int,
    count: Int,
    after: Int,
  ) {
    // noop
  }

  override fun onTextChanged(
    s: CharSequence?,
    start: Int,
    before: Int,
    count: Int,
  ) {
    // noop
  }

  override fun afterTextChanged(s: Editable?) {
    attachSelectionWatcher(s)
    if (isUpdating) {
      return
    }

    val editValue = s?.toString() ?: ""

    // For some reason, text change events are dispatched multiple times with the same value, which
    // causes issue with how we track previous values. To avoid this and match iOS behavior we ignore
    // events in the same frame that have the same text value.
    if (lastEventValue == editValue) {
      return
    }
    lastEventValue = editValue
    resetLastEventValueJob?.cancel()
    resetLastEventValueJob =
      MainScope().launch(Dispatchers.Main) {
        lastEventValue = null
        resetLastEventValueJob = null
      }

    val currentSelection = currentSelection()
    val current = TextState(editValue, currentSelection)
    val next = transformTextState(current, true)
    val didTransformValue = next.value != current.value
    isUpdating = true
    try {
      if (didTransformValue) {
        applyValue(next.value)
      }
      if (
        didTransformValue || next.selection != currentSelection
      ) {
        applySelection(next.selection)
      }
    } finally {
      isUpdating = false
    }
  }

  fun update(
    transform: Boolean,
    value: String?,
    selectionStart: Int,
    selectionEnd: Int,
  ) {
    if (reactEditText == null) {
      return
    }
    val currentValue = currentValue()
    val currentSelection = currentSelection()
    val providedValue = value ?: currentValue
    val providedSelection = TextSelection(selectionStart, selectionEnd)
    val provided = TextState(providedValue, providedSelection)
    val next = transformTextState(provided, transform)

    val didTransformValue = next.value != currentValue
    isUpdating = true
    try {
      if (didTransformValue) {
        applyValue(next.value)
      }
      if (
        didTransformValue || next.selection != currentSelection
      ) {
        applySelection(next.selection)
      }
    } finally {
      isUpdating = false
    }
  }
}
