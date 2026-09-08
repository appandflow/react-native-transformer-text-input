#include "TransformerTextInputRuntime.h"

namespace rntti {

namespace {
std::weak_ptr<worklets::WorkletRuntime> gUiRuntime;

void LogTransformerError(jsi::Runtime &runtime, const std::string &message) {
  try {
    auto console = runtime.global().getPropertyAsObject(runtime, "console");
    auto errorFunction = console.getPropertyAsFunction(runtime, "error");
    errorFunction.call(
        runtime,
        jsi::String::createFromUtf8(
            runtime, "[rntti] Transformer threw an error: " + message));
  } catch (const jsi::JSIException &) {
    // console is not guaranteed to exist on the worklet runtime.
  }
}
} // namespace

void SetUIWorkletRuntime(
    const std::shared_ptr<worklets::WorkletRuntime> &runtime) {
  if (!runtime) {
    gUiRuntime.reset();
    return;
  }
  runtime->schedule([runtime](jsi::Runtime &) { gUiRuntime = runtime; });
}

std::optional<jsi::WeakObject> LookupTransformer(int transformerId) {
  auto uiRuntime = gUiRuntime.lock();
  if (!uiRuntime) {
    return std::nullopt;
  }
  auto &runtime = uiRuntime->getJSIRuntime();
  auto transformerRegistry = runtime.global().getPropertyAsObject(
      runtime, "__rntti_registerTransformerRegistry");
  auto transformerRegistryGet =
      transformerRegistry.getPropertyAsFunction(runtime, "get");
  auto transformerValue =
      transformerRegistryGet.call(runtime, jsi::Value(transformerId));

  if (transformerValue.isNull() || transformerValue.isUndefined() ||
      !transformerValue.isObject()) {
    return std::nullopt;
  }

  return jsi::WeakObject(runtime, transformerValue.asObject(runtime));
}

std::optional<TransformResult> RunTransformer(
    const std::optional<jsi::WeakObject> &transformer,
    const std::string &value,
    SelectionRange selection,
    bool transform) {
  if (!transformer) {
    return std::nullopt;
  }

  auto uiRuntime = gUiRuntime.lock();
  if (!uiRuntime) {
    return std::nullopt;
  }

  auto &jsiRuntime = uiRuntime->getJSIRuntime();

  auto transformerValue = transformer->lock(jsiRuntime);
  if (transformerValue.isUndefined()) {
    return std::nullopt;
  }

  auto transformerFunction =
      transformerValue.asObject(jsiRuntime).asFunction(jsiRuntime);

  try {
    auto resultValue = uiRuntime->runSync(
        transformerFunction,
        jsi::String::createFromUtf8(jsiRuntime, value),
        jsi::Value(selection.start),
        jsi::Value(selection.end),
        jsi::Value(transform));

    // In debug builds runSync guards the call: a throwing transformer is
    // reported to LogBox and undefined is returned instead of a result
    // object.
    if (!resultValue.isObject()) {
      return std::nullopt;
    }

    TransformResult result;
    auto resultObject = resultValue.asObject(jsiRuntime);
    auto valueProp = resultObject.getProperty(jsiRuntime, "value");
    if (valueProp.isString()) {
      result.value = valueProp.asString(jsiRuntime).utf8(jsiRuntime);
    }

    auto selectionProp = resultObject.getProperty(jsiRuntime, "selection");
    if (selectionProp.isObject()) {
      auto selectionObject = selectionProp.asObject(jsiRuntime);
      auto startProp = selectionObject.getProperty(jsiRuntime, "start");
      auto endProp = selectionObject.getProperty(jsiRuntime, "end");
      result.selection = SelectionRange{
          static_cast<int>(startProp.asNumber()),
          static_cast<int>(endProp.asNumber())};
    }

    return result;
  } catch (const jsi::JSError &error) {
    LogTransformerError(jsiRuntime, error.getMessage());
    return std::nullopt;
  } catch (const jsi::JSIException &error) {
    LogTransformerError(jsiRuntime, error.what());
    return std::nullopt;
  }
}

} // namespace rntti
