local RunService = game:GetService("RunService")
local StudioTestService = game:GetService("StudioTestService")
local ServerScriptService = game:GetService("ServerScriptService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local COOLDOWN = 3
local RUNNER_NAME = "__BridgeTestRunner"
local BODY_NAME = "__BridgeTestBody"

local RUNNER_SOURCE = [==[
local StudioTestService = game:GetService("StudioTestService")
local LogService = game:GetService("LogService")

local timeout = script:GetAttribute("Timeout") or 60
local startedAt = os.clock()
local logs = {}
local signals = {}
local finished = false

LogService.MessageOut:Connect(function(message, messageType)
	if #logs < 500 then
		table.insert(logs, {message = message, kind = messageType.Name})
	end
end)

local function finish(passed, errorMessage, returned, timedOut)
	if finished then
		return
	end

	finished = true

	StudioTestService:EndTest({
		passed = passed,
		errorMessage = errorMessage,
		returned = returned,
		timedOut = timedOut,
		durationMs = math.floor((os.clock() - startedAt) * 1000),
		logs = logs,
		signals = signals,
	})
end

task.delay(timeout, function()
	finish(false, "timed out after " .. timeout .. "s", nil, true)
end)

local context = {
	signal = function(name, data)
		table.insert(signals, {name = tostring(name), data = data})
	end,
	fail = function(message)
		error(tostring(message), 0)
	end,
}

task.spawn(function()
	local body = require(script.Parent:WaitForChild("__BridgeTestBody"))
	local results = table.pack(xpcall(body, function(message)
		return tostring(message) .. "\n" .. debug.traceback()
	end, context))

	if results[1] then
		finish(true, nil, if results[2] ~= nil then tostring(results[2]) else nil, false)
	else
		finish(false, results[2], nil, false)
	end
end)
]==]

if type(params.script) ~= "string" or params.script == "" then
	error("script is required")
end

if RunService:IsRunning() then
	error("a play session is already running; call play_stop first")
end

local bridgeState = shared.__StudioBridge

if not bridgeState then
	bridgeState = {lastPlayEnded = 0}
	shared.__StudioBridge = bridgeState
end

local wait = COOLDOWN - (os.clock() - bridgeState.lastPlayEnded)

if wait > 0 then
	task.wait(wait)
end

local testName = params.test_name or "run_test"
local mode = if params.mode == "run" then "run" else "play"
local timeout = math.clamp(math.floor(params.timeout_seconds or 60), 1, 300)

local function write(script, text)
	local ok = pcall(function()
		ScriptEditorService:UpdateSourceAsync(script, function()
			return text
		end)
	end)

	if not ok then
		script.Source = text
	end
end

local function cleanup()
	for _, name in ipairs({RUNNER_NAME, BODY_NAME}) do
		local leftover = ServerScriptService:FindFirstChild(name)

		while leftover do
			pcall(function()
				leftover:Destroy()
			end)

			leftover = ServerScriptService:FindFirstChild(name)
		end
	end
end

cleanup()

local body = Instance.new("ModuleScript")
body.Name = BODY_NAME
write(body, "return function(test)\n" .. params.script .. "\nend")
body.Parent = ServerScriptService

local runner = Instance.new("Script")
runner.Name = RUNNER_NAME
runner:SetAttribute("Timeout", timeout)
write(runner, RUNNER_SOURCE)
runner.Parent = ServerScriptService

local done = false
local outcome
local failure
local startedClock = os.clock()

task.spawn(function()
	local ok, result = pcall(function()
		if mode == "run" then
			return StudioTestService:ExecuteRunModeAsync({})
		end

		return StudioTestService:ExecutePlayModeAsync({})
	end)

	if ok then
		outcome = result
	else
		failure = tostring(result)
	end

	done = true
end)

local deadline = os.clock() + timeout + 20

while not done and os.clock() < deadline do
	task.wait(0.1)
end

cleanup()
bridgeState.lastPlayEnded = os.clock()

local lines = {}

if not done then
	return "FAIL  " .. testName .. "\nthe play session did not end within " .. (timeout + 20) .. "s; stop it from Studio"
end

if failure then
	return "FAIL  " .. testName .. "\nplay session failed to start: " .. failure
end

if type(outcome) ~= "table" then
	return "FAIL  " .. testName .. "\nthe session ended without a result (it may have been stopped manually)"
end

table.insert(lines, string.format("%s  %s  (%d ms, %s mode)", if outcome.passed then "PASS" else "FAIL", testName, outcome.durationMs or math.floor((os.clock() - startedClock) * 1000), mode))

if outcome.errorMessage then
	table.insert(lines, "error: " .. tostring(outcome.errorMessage))
end

if outcome.returned then
	table.insert(lines, "returned: " .. tostring(outcome.returned))
end

if type(outcome.signals) == "table" and #outcome.signals > 0 then
	table.insert(lines, "signals:")

	for _, signal in ipairs(outcome.signals) do
		local ok, encoded = pcall(function()
			return game:GetService("HttpService"):JSONEncode(signal.data)
		end)

		table.insert(lines, "  " .. signal.name .. (if ok and encoded ~= "null" then " " .. encoded else ""))
	end
end

local logLimit = params.log_lines or 40

if type(outcome.logs) == "table" and #outcome.logs > 0 then
	local first = math.max(1, #outcome.logs - logLimit + 1)

	table.insert(lines, string.format("logs (%d of %d):", #outcome.logs - first + 1, #outcome.logs))

	for index = first, #outcome.logs do
		local entry = outcome.logs[index]
		table.insert(lines, "  [" .. string.lower((string.gsub(entry.kind, "^Message", ""))) .. "] " .. entry.message)
	end
end

return table.concat(lines, "\n")
