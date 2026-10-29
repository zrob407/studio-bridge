local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local context = ({...})[1] or {}

local ROLE = if not RunService:IsRunning() then "edit" elseif RunService:IsServer() then "server" else "client"

local URL = "http://127.0.0.1:__PORT__"
local TOKEN = "__TOKEN__"
local CLIENT_ID = context.clientId or HttpService:GenerateGUID(false)
local MAX_OUTPUT_CHARS = 30000
local MAX_TABLE_ENTRIES = 60
local MAX_DEPTH = 3
local RETRY_DELAY = 3
local DEFAULT_COMMAND_TIMEOUT = 60
local RESULT_ATTEMPTS = 3
local HEARTBEAT_SECONDS = 10
local OPEN_TIMEOUT = 6
local MAX_RECONNECT_DELAY = 20
local MAX_RESULT_BYTES = 32 * 1024 * 1024
local SOCKET_PROTOCOL = 1
local WS_URL = string.gsub(URL, "^http", "ws") .. "/ws"

local format

local function formatTable(value, depth, seen)
	if seen[value] then
		return "{<cycle>}"
	end

	if depth >= MAX_DEPTH then
		return "{...}"
	end

	seen[value] = true

	local parts = {}
	local count = 0

	for key, item in value do
		count += 1

		if count > MAX_TABLE_ENTRIES then
			table.insert(parts, "...")
			break
		end

		table.insert(parts, "[" .. format(key, depth + 1, seen) .. "] = " .. format(item, depth + 1, seen))
	end

	seen[value] = nil

	return "{" .. table.concat(parts, ", ") .. "}"
end

function format(value, depth, seen)
	local kind = typeof(value)

	if kind == "string" then
		return if depth == 0 then value else string.format("%q", value)
	elseif kind == "Instance" then
		return value:GetFullName() .. " <" .. value.ClassName .. ">"
	elseif kind == "table" then
		return formatTable(value, depth, seen)
	end

	return tostring(value)
end

local function join(...)
	local parts = table.pack(...)
	local out = {}

	for index = 1, parts.n do
		out[index] = format(parts[index], 0, {})
	end

	return table.concat(out, "\t")
end

local BASE64_ALPHABET = {}

for index = 0, 63 do
	BASE64_ALPHABET[index] = string.sub("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", index + 1, index + 1)
end

local function encodeBase64(data)
	if typeof(data) == "buffer" then
		data = buffer.readstring(data, 0, buffer.len(data))
	end

	local parts = {}

	for index = 1, #data, 3 do
		local a, b, c = string.byte(data, index, index + 2)
		local value = a * 65536 + (b or 0) * 256 + (c or 0)
		local first = BASE64_ALPHABET[bit32.band(bit32.rshift(value, 18), 63)]
		local second = BASE64_ALPHABET[bit32.band(bit32.rshift(value, 12), 63)]
		local third = if b then BASE64_ALPHABET[bit32.band(bit32.rshift(value, 6), 63)] else "="
		local fourth = if c then BASE64_ALPHABET[bit32.band(value, 63)] else "="

		table.insert(parts, first .. second .. third .. fourth)
	end

	return table.concat(parts)
end

local function makeEnv(lines, files)
	local env = {
		print = function(...)
			table.insert(lines, join(...))
		end,
		warn = function(...)
			table.insert(lines, "[warn] " .. join(...))
		end,
		bridge = {
			attachFile = function(name, data)
				table.insert(files, {name = tostring(name), base64 = encodeBase64(data)})
			end,
			encodeBase64 = encodeBase64,
		},
	}

	return setmetatable(env, {__index = getfenv()})
end

local function compile(code)
	local available, fn, compileError = pcall(loadstring, code, "=run_luau")

	if available then
		return fn, compileError
	end

	local module = Instance.new("ModuleScript")
	module.Name = "__BridgeChunk"
	module.Source = "return function(...) " .. code .. "\nend"

	local loaded, built = pcall(require, module)

	module:Destroy()

	if not loaded then
		return nil, tostring(built)
	end

	return built, nil
end

local function finishRecording(context)
	local recording = context.recording

	if recording then
		context.recording = nil

		pcall(function()
			ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
		end)
	end
end

local function execute(code, context)
	context = context or {}

	local lines = {}
	local files = {}
	local fn, compileError = compile(code)

	if not fn then
		return {ok = false, error = tostring(compileError), output = lines}
	end

	pcall(setfenv, fn, makeEnv(lines, files))

	local recorded, recording = pcall(function()
		return ChangeHistoryService:TryBeginRecording("Claude run_luau")
	end)

	if recorded and recording then
		context.recording = recording
	end

	local results = table.pack(xpcall(fn, function(message)
		return tostring(message) .. "\n" .. debug.traceback()
	end))

	finishRecording(context)

	if not results[1] then
		return {ok = false, error = results[2], output = lines}
	end

	local returned = {}

	for index = 2, results.n do
		returned[index - 1] = format(results[index], 0, {})
	end

	return {ok = true, returned = returned, output = lines, files = files}
end

local function truncate(result)
	local total = 0

	for index, line in result.output do
		total += #line

		if total > MAX_OUTPUT_CHARS then
			for drop = #result.output, index + 1, -1 do
				table.remove(result.output, drop)
			end

			result.output[index] = string.sub(line, 1, math.max(0, #line - (total - MAX_OUTPUT_CHARS))) .. "\n[output truncated]"

			break
		end
	end

	if result.returned then
		for index, line in result.returned do
			if #line > MAX_OUTPUT_CHARS then
				result.returned[index] = string.sub(line, 1, MAX_OUTPUT_CHARS) .. "\n[truncated]"
			end
		end
	end

	if result.error and #result.error > MAX_OUTPUT_CHARS then
		result.error = string.sub(result.error, 1, MAX_OUTPUT_CHARS) .. "\n[truncated]"
	end
end

local function post(path, payload)
	return pcall(function()
		return HttpService:RequestAsync({
			Url = URL .. path,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Bridge-Token"] = TOKEN,
			},
			Body = HttpService:JSONEncode(payload),
		})
	end)
end

local function placeName()
	local ok, name = pcall(function()
		return game.Name
	end)

	return if ok then name else "Unknown"
end

local function hello()
	return {
		id = CLIENT_ID,
		role = ROLE,
		placeId = game.PlaceId,
		gameId = game.GameId,
		placeName = placeName(),
	}
end

local lastFailure

local function describeFailure(ok, response)
	return if ok then "HTTP " .. tostring(response.StatusCode) .. " " .. tostring(response.StatusMessage) else tostring(response)
end

local function reportFailure(ok, response)
	local message = describeFailure(ok, response)

	if message ~= lastFailure then
		lastFailure = message
		warn("[ClaudeStudioBridge:" .. ROLE .. "] cannot reach the bridge: " .. message)
	end
end

local socket
local unacked = {}
local seen = {}
local stopped = false
local running = 0

local function sendText(session, text)
	return (pcall(function()
		session.client:Send(text)
	end))
end

local function sendJson(session, payload)
	return sendText(session, HttpService:JSONEncode(payload))
end

local RELAY_NAME = "__BridgeRelay"
local RELAY_TIMEOUT = 30
local relay

if ROLE == "server" then
	relay = Instance.new("RemoteFunction")
	relay.Name = RELAY_NAME
	relay.Parent = game:GetService("ReplicatedStorage")
elseif ROLE == "client" then
	task.spawn(function()
		local remote = game:GetService("ReplicatedStorage"):WaitForChild(RELAY_NAME, 60)

		if remote then
			remote.OnClientInvoke = function(code)
				local executed, result = pcall(execute, code)

				if not executed then
					result = {ok = false, error = "bridge error: " .. tostring(result), output = {}}
				end

				pcall(truncate, result)

				return result
			end
		end
	end)
end

local function relayToClient(code, timeout)
	local player = game:GetService("Players"):GetPlayers()[1]

	if not relay or not player then
		return {ok = false, error = "no client is connected to this session", output = {}}
	end

	local limit = math.max(RELAY_TIMEOUT, timeout or 0)
	local result

	task.spawn(function()
		local ok, value = pcall(function()
			return relay:InvokeClient(player, code)
		end)

		result = if ok and type(value) == "table" then value else {ok = false, error = "relay failed: " .. tostring(value), output = {}}
	end)

	local deadline = os.clock() + limit

	while not result and os.clock() < deadline do
		task.wait(0.05)
	end

	return result or {ok = false, error = "the client did not answer within " .. limit .. "s (is the client plugin loaded?)", output = {}}
end

local function deliverOverHttp(result)
	local reason = "unknown"

	for attempt = 1, RESULT_ATTEMPTS do
		local ok, response = post("/result", result)

		if ok and response.Success then
			return
		end

		reason = describeFailure(ok, response)
		task.wait(attempt)
	end

	post("/result", {
		requestId = result.requestId,
		ok = false,
		error = "Studio finished but the result could not be delivered after " .. RESULT_ATTEMPTS .. " attempts (" .. reason .. ")",
		output = {},
	})
end

local function deliver(result)
	local session = socket

	if session and session.ready then
		result.type = "result"

		local encoded = HttpService:JSONEncode(result)

		if #encoded > MAX_RESULT_BYTES then
			result = {
				type = "result",
				requestId = result.requestId,
				ok = false,
				error = "The result was " .. #encoded .. " bytes, over the " .. MAX_RESULT_BYTES .. " byte limit, and was dropped.",
				output = {},
			}
			encoded = HttpService:JSONEncode(result)
		end

		unacked[result.requestId] = result

		if sendText(session, encoded) then
			return
		end
	end

	deliverOverHttp(result)

	unacked[result.requestId] = nil
	seen[result.requestId] = nil
end

local function runCommand(decoded)
	local limit = if type(decoded.timeout) == "number" and decoded.timeout > 0 then decoded.timeout else DEFAULT_COMMAND_TIMEOUT
	local context = {}
	local finished = false
	local result

	local worker = task.spawn(function()
		local executed, value

		if decoded.target == "client" then
			executed, value = pcall(relayToClient, decoded.code, limit)
		else
			executed, value = pcall(execute, decoded.code, context)
		end

		if not executed then
			value = {ok = false, error = "bridge error: " .. tostring(value), output = {}}
		end

		result = value
		finished = true
	end)

	local deadline = os.clock() + limit

	while not finished and os.clock() < deadline do
		task.wait(0.05)
	end

	if not finished then
		pcall(task.cancel, worker)
		finishRecording(context)
		result = {ok = false, error = "Cancelled by the bridge plugin after " .. limit .. "s; the code was still running.", output = {}}
	end

	pcall(truncate, result)

	result.requestId = decoded.requestId

	deliver(result)
end

local function acceptCommand(command, session)
	local requestId = command.requestId

	if type(requestId) ~= "string" then
		return
	end

	if session then
		sendJson(session, {type = "ack", requestId = requestId})
	end

	if seen[requestId] then
		local stored = unacked[requestId]

		if stored then
			if session then
				sendJson(session, stored)
			else
				task.spawn(function()
					deliverOverHttp(stored)

					unacked[requestId] = nil
					seen[requestId] = nil
				end)
			end
		end

		return
	end

	seen[requestId] = true
	running += 1

	task.spawn(function()
		pcall(runCommand, command)

		running -= 1
	end)
end

local function flushUnacked()
	for requestId, stored in unacked do
		local ok, response = post("/result", stored)

		if ok and response.Success then
			unacked[requestId] = nil
			seen[requestId] = nil
		end
	end
end

local function step()
	if next(unacked) then
		flushUnacked()
	end

	local ok, response = post("/poll", hello())

	if not ok or not response.Success then
		reportFailure(ok, response)
		task.wait(RETRY_DELAY)

		return
	end

	if lastFailure then
		lastFailure = nil
		print("[ClaudeStudioBridge:" .. ROLE .. "] connected")
	end

	local decoded = HttpService:JSONDecode(response.Body)

	if decoded.requestId then
		acceptCommand(decoded, nil)
	end
end

local function handleSocketMessage(session, raw)
	local decoded, message = pcall(function()
		return HttpService:JSONDecode(raw)
	end)

	if not decoded or type(message) ~= "table" then
		return
	end

	if message.type == "hello_ack" then
		session.acknowledged = true
		session.ready = true
		socket = session
	elseif message.type == "command" then
		acceptCommand(message, session)
	elseif message.type == "result_ack" then
		unacked[message.requestId] = nil
		seen[message.requestId] = nil
	end
end

local function runSocketSession()
	local created, client = pcall(function()
		return HttpService:CreateWebStreamClient(Enum.WebStreamClientType.WebSocket, {
			Url = WS_URL,
			Headers = {["X-Bridge-Token"] = TOKEN},
		})
	end)

	if not created then
		return false, tostring(client)
	end

	local session = {client = client, opened = false, closed = false, acknowledged = false, ready = false}

	client.Opened:Connect(function()
		session.opened = true
	end)
	client.Closed:Connect(function()
		session.closed = true
	end)
	client.Error:Connect(function(status, message)
		session.closed = true
		session.problem = tostring(status) .. " " .. tostring(message)
	end)
	client.MessageReceived:Connect(function(raw)
		handleSocketMessage(session, raw)
	end)

	local function waitFor(condition)
		local deadline = os.clock() + OPEN_TIMEOUT

		while not condition() and not session.closed and os.clock() < deadline do
			task.wait(0.05)
		end

		return condition()
	end

	local function endSession(problem)
		session.ready = false

		if socket == session then
			socket = nil
		end

		pcall(function()
			client:Close()
		end)

		return problem
	end

	if not waitFor(function()
		return session.opened
	end) then
		return false, endSession(session.problem or "could not open the websocket")
	end

	local info = hello()

	info.type = "hello"
	info.protocol = SOCKET_PROTOCOL
	sendJson(session, info)

	if not waitFor(function()
		return session.acknowledged
	end) then
		return false, endSession(session.problem or "the bridge did not answer the handshake")
	end

	for _, stored in unacked do
		sendJson(session, stored)
	end

	sendJson(session, {type = "ready"})

	if lastFailure then
		lastFailure = nil
		print("[ClaudeStudioBridge:" .. ROLE .. "] connected (websocket)")
	end

	local nextBeat = os.clock() + HEARTBEAT_SECONDS

	while not session.closed and not stopped do
		task.wait(0.25)

		if os.clock() >= nextBeat then
			nextBeat = os.clock() + HEARTBEAT_SECONDS

			if not sendJson(session, {type = "heartbeat"}) then
				break
			end
		end
	end

	return true, endSession(session.problem or "connection closed")
end

if ROLE == "server" then
	game:BindToClose(function()
		local session = socket

		if session then
			sendJson(session, {type = "goodbye"})
			task.wait(0.2)
		end
	end)
end

if ROLE ~= "client" then
	task.spawn(function()
		while not stopped do
			local session = socket

			if session and session.ready then
				task.wait(1)
			else
				local alive, problem = pcall(step)

				if not alive then
					warn("[ClaudeStudioBridge:" .. ROLE .. "] " .. tostring(problem))
					task.wait(RETRY_DELAY)
				end
			end
		end
	end)

	task.spawn(function()
		local failures = 0

		while not stopped do
			local alive, completed = pcall(runSocketSession)

			if alive and completed then
				failures = 0
				task.wait(1)
			else
				failures += 1
				task.wait(math.min(failures * 2, MAX_RECONNECT_DELAY))
			end
		end
	end)
end

local function stop()
	stopped = true

	local session = socket

	if session then
		session.closed = true

		pcall(function()
			session.client:Close()
		end)
	end
end

local function busy()
	return running > 0 or next(unacked) ~= nil
end

return {stop = stop, busy = busy}
