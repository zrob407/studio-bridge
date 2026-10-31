local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local context = ({...})[1] or {}

local ROLE = if not RunService:IsRunning() then "edit" elseif RunService:IsServer() then "server" else "client"

print("[Studio Bridge:" .. ROLE .. "] plugin " .. tostring(context.version or "standalone") .. " loaded")

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

local status = {state = "connecting", detail = "", transport = nil, commands = 0, failures = 0, lastCommand = nil, lastCommandAt = 0, startedAt = os.clock(), log = {}}

local function record(text)
	table.insert(status.log, os.date("%H:%M:%S") .. " " .. text)

	if #status.log > 40 then
		table.remove(status.log, 1)
	end
end

local function setStatus(state, detail, transport)
	if status.state ~= state or status.detail ~= detail then
		record(if detail ~= "" then state .. ": " .. detail else state)
	end

	status.state = state
	status.detail = detail
	status.transport = transport
end

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
		return ChangeHistoryService:TryBeginRecording("Studio Bridge run_luau")
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
		warn("[Studio Bridge:" .. ROLE .. "] cannot reach the bridge: " .. message)
		setStatus("offline", "cannot reach the bridge: " .. message)
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
	relay.OnServerInvoke = function(_, request)
		if request == "plugin" then
			return context.clientBody
		end

		return nil
	end
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
	local startedAt = os.clock()
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

	status.commands += 1

	if not result.ok then
		status.failures += 1
	end

	status.lastCommand = string.format("%s in %.2fs", if result.ok then "ok" else "failed", os.clock() - startedAt)
	status.lastCommandAt = os.clock()
	record("command " .. status.lastCommand)

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

	if not (socket and socket.ready) then
		setStatus("connected", "", "http")
	end

	if lastFailure then
		lastFailure = nil
		print("[Studio Bridge:" .. ROLE .. "] connected")
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
		setStatus("reconnecting", tostring(problem or "connection closed"))

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
	setStatus("connected", "", "websocket")

	if lastFailure then
		lastFailure = nil
		print("[Studio Bridge:" .. ROLE .. "] connected (websocket)")
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
					warn("[Studio Bridge:" .. ROLE .. "] " .. tostring(problem))
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

local studioPlugin = context.plugin or plugin
local BUTTON_ICON = "rbxassetid://111845153082022"
local statusUi

local ACCENT = Color3.fromRGB(79, 216, 255)
local ON_ACCENT = Color3.fromRGB(10, 22, 44)
local GOOD = Color3.fromRGB(80, 200, 120)
local GOLD = Color3.fromRGB(255, 209, 102)
local WARN = Color3.fromRGB(230, 180, 60)
local BAD = Color3.fromRGB(230, 90, 90)
local PAGES = {"Status", "Tools", "Pro", "Log"}
local STATES = {
	connected = {"Connected", GOOD},
	connecting = {"Connecting", WARN},
	reconnecting = {"Reconnecting", WARN},
	offline = {"Not connected", BAD},
}

local function elapsed(seconds)
	if seconds < 60 then
		return string.format("%ds", seconds)
	elseif seconds < 3600 then
		return string.format("%dm", seconds // 60)
	end

	return string.format("%dh %dm", seconds // 3600, (seconds % 3600) // 60)
end

local function tokenText(tokens)
	if tokens >= 1000 then
		return string.format("%.1fk", tokens / 1000)
	end

	return tostring(tokens)
end

local function normalizeProfile(profile)
	local wanted = {}

	for entry in string.gmatch(string.lower(tostring(profile)), "[^,%s]+") do
		if entry == "all" then
			return "all"
		end

		if entry ~= "core" then
			wanted[entry] = true
		end
	end

	local names = {}

	for name in wanted do
		table.insert(names, name)
	end

	table.sort(names)

	return if #names == 0 then "core" else table.concat(names, ",")
end

local function hexOf(value)
	return string.format("#%02x%02x%02x", math.round(value.R * 255), math.round(value.G * 255), math.round(value.B * 255))
end

local function buildStatusWidget()
	local holder = shared.__StudioBridgeStatusUi

	if not holder then
		holder = {}
		shared.__StudioBridgeStatusUi = holder
	end

	local alive = holder.widget and pcall(function()
		return holder.widget.Title
	end)

	if not alive then
		holder.widget = studioPlugin:CreateDockWidgetPluginGui(
			"StudioBridgeStatus",
			DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 360, 540, 300, 380)
		)
		holder.widget.Title = "Studio Bridge"
		holder.button = studioPlugin:CreateToolbar("Studio Bridge"):CreateButton("StudioBridgeStatus", "Show or hide the Studio Bridge window", BUTTON_ICON, "Status")
		holder.button.ClickableWhenViewportHidden = true
	end

	holder.button.Icon = BUTTON_ICON

	local widget = holder.widget
	local studioSettings = settings().Studio

	for _, child in widget:GetChildren() do
		child:Destroy()
	end

	if holder.click then
		holder.click:Disconnect()
	end

	if holder.theme then
		holder.theme:Disconnect()
	end

	holder.click = holder.button.Click:Connect(function()
		widget.Enabled = not widget.Enabled
	end)

	local themed = {}

	local function color(guide)
		return studioSettings.Theme:GetColor(guide)
	end

	local function background()
		return color(Enum.StudioStyleGuideColor.MainBackground)
	end

	local function card()
		return color(Enum.StudioStyleGuideColor.InputFieldBackground)
	end

	local function line()
		return color(Enum.StudioStyleGuideColor.Border)
	end

	local function mainText()
		return color(Enum.StudioStyleGuideColor.MainText)
	end

	local function dimText()
		return color(Enum.StudioStyleGuideColor.DimmedText)
	end

	local function onTheme(apply)
		table.insert(themed, apply)
		apply()
	end

	local function create(className, properties, parent)
		local instance = Instance.new(className)

		for key, value in properties do
			instance[key] = value
		end

		instance.Parent = parent

		return instance
	end

	local function rounded(parent, radius)
		return create("UICorner", {CornerRadius = UDim.new(0, radius)}, parent)
	end

	local function label(parent, properties)
		local made = create("TextLabel", {
			BackgroundTransparency = 1,
			Font = Enum.Font.BuilderSans,
			TextSize = 14,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Center,
			TextTruncate = Enum.TextTruncate.AtEnd,
			RichText = true,
			Text = "",
		}, parent)

		for key, value in properties do
			made[key] = value
		end

		return made
	end

	local root = create("Frame", {Size = UDim2.fromScale(1, 1), BorderSizePixel = 0}, widget)

	onTheme(function()
		root.BackgroundColor3 = background()
	end)

	local header = create("Frame", {Size = UDim2.new(1, 0, 0, 64), BackgroundTransparency = 1}, root)
	local logo = create("ImageLabel", {Size = UDim2.fromOffset(40, 40), Position = UDim2.fromOffset(14, 12), BackgroundTransparency = 1, Image = BUTTON_ICON}, header)

	rounded(logo, 10)

	local title = label(header, {Position = UDim2.fromOffset(64, 10), Size = UDim2.new(1, -306, 0, 24), Font = Enum.Font.BuilderSansBold, TextSize = 20, Text = "Studio Bridge"})
	local subtitle = label(header, {Position = UDim2.fromOffset(64, 34), Size = UDim2.new(1, -306, 0, 18), TextSize = 13})
	local pill = create("Frame", {AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -58, 0, 32), Size = UDim2.fromOffset(176, 28), BorderSizePixel = 0}, header)

	rounded(pill, 14)

	local dot = create("Frame", {Position = UDim2.fromOffset(12, 9), Size = UDim2.fromOffset(10, 10), BorderSizePixel = 0}, pill)

	rounded(dot, 5)

	-- The settings gear from OPNduck (Tabler "settings"): a wavy ring around a smaller ring. Roblox cannot draw the
	-- SVG path without an uploaded image, so it is built from circles, fitted to the original shape on a 24 unit grid.
	local COG_UNIT = 1.25
	local cogButton = create("TextButton", {AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -14, 0, 32), Size = UDim2.fromOffset(32, 32), BackgroundTransparency = 1, AutoButtonColor = false, Text = ""}, header)
	local cog = create("Frame", {AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(24 * COG_UNIT, 24 * COG_UNIT), BackgroundTransparency = 1}, cogButton)
	local cogInk = {}
	local cogCutout = {}

	local function cogDisc(radius, offsetX, offsetY, group)
		local disc = create("Frame", {AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, offsetX * COG_UNIT, 0.5, offsetY * COG_UNIT), Size = UDim2.fromOffset(radius * 2 * COG_UNIT, radius * 2 * COG_UNIT), BorderSizePixel = 0}, cog)

		rounded(disc, radius * COG_UNIT)
		table.insert(group, disc)
	end

	-- Eight lobes around a body: the outer shape in ink, then the inner one cut out in the page color.
	local function cogShape(body, lobe, lobeDistance, group)
		cogDisc(body, 0, 0, group)

		for step = 0, 7 do
			local angle = math.rad(step * 45)

			cogDisc(lobe, math.sin(angle) * lobeDistance, -math.cos(angle) * lobeDistance, group)
		end
	end

	cogShape(8.2, 2.6, 7.5, cogInk)
	cogShape(6.4, 0.8, 7.2, cogCutout)
	cogDisc(4, 0, 0, cogInk)
	cogDisc(2, 0, 0, cogCutout)

	local pillText = label(pill, {Position = UDim2.fromOffset(28, 0), Size = UDim2.new(1, -34, 1, 0), Font = Enum.Font.BuilderSansBold, TextSize = 13})

	onTheme(function()
		title.TextColor3 = mainText()
		subtitle.TextColor3 = dimText()
		pill.BackgroundColor3 = card()
		pillText.TextColor3 = mainText()
	end)

	local tabBar = create("Frame", {Position = UDim2.fromOffset(0, 64), Size = UDim2.new(1, 0, 0, 36), BackgroundTransparency = 1}, root)

	create("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, SortOrder = Enum.SortOrder.LayoutOrder}, tabBar)

	local divider = create("Frame", {Position = UDim2.fromOffset(0, 99), Size = UDim2.new(1, 0, 0, 1), BorderSizePixel = 0}, root)

	onTheme(function()
		divider.BackgroundColor3 = line()
	end)

	local content = create("Frame", {Position = UDim2.fromOffset(0, 100), Size = UDim2.new(1, 0, 1, -100), BackgroundTransparency = 1}, root)
	local tabs = {}
	local pages = {}
	local selected = "Status"
	local loadProfile
	local loadPro
	local loadConfig
	local toolsPage
	local proPage

	local cogHovered = false

	local function paintCog()
		local tint = if cogHovered then Color3.fromRGB(255, 255, 255) elseif selected == "Config" then ACCENT else dimText()

		for _, part in cogInk do
			part.BackgroundColor3 = tint
		end

		for _, part in cogCutout do
			part.BackgroundColor3 = background()
		end
	end

	local function paintTabs()
		for name, entry in tabs do
			local active = name == selected

			entry.button.TextColor3 = if active then mainText() else dimText()
			entry.underline.BackgroundColor3 = ACCENT
			entry.underline.Visible = active
		end

		for name, page in pages do
			page.Visible = name == selected
		end

		paintCog()
	end

	local function openPage(name)
		selected = name
		paintTabs()

		if name == "Tools" then
			toolsPage.CanvasPosition = Vector2.zero
			loadProfile()
		elseif name == "Pro" then
			loadPro()
		elseif name == "Config" then
			loadConfig()
		end
	end

	-- The same easing OPNduck gives its settings gear: cubic-bezier(0.5, 0, 0.2, 1) over 0.9 seconds, one full turn.
	local function cubicBezier(x1, y1, x2, y2)
		local function sample(a, b, t)
			local inverse = 1 - t

			return 3 * a * inverse * inverse * t + 3 * b * inverse * t * t + t * t * t
		end

		return function(progress)
			local low, high = 0, 1

			for _ = 1, 24 do
				local middle = (low + high) / 2

				if sample(x1, x2, middle) < progress then
					low = middle
				else
					high = middle
				end
			end

			return sample(y1, y2, (low + high) / 2)
		end
	end

	local COG_SPIN_SECONDS = 0.9
	local cogEase = cubicBezier(0.5, 0, 0.2, 1)
	local cogSpin

	local function spinCog()
		if cogSpin then
			return
		end

		local elapsed = 0

		cogSpin = RunService.Heartbeat:Connect(function(step)
			elapsed += step

			if elapsed >= COG_SPIN_SECONDS then
				cog.Rotation = 0
				cogSpin:Disconnect()
				cogSpin = nil
			else
				cog.Rotation = 360 * cogEase(elapsed / COG_SPIN_SECONDS)
			end
		end)
	end

	cogButton.MouseButton1Click:Connect(function()
		openPage(if selected == "Config" then "Status" else "Config")
	end)
	cogButton.MouseEnter:Connect(function()
		cogHovered = true
		paintCog()
		spinCog()
	end)
	cogButton.MouseLeave:Connect(function()
		cogHovered = false
		paintCog()
	end)
	-- No leave event arrives when the window is hidden under the pointer, so clear the hover then as well.
	widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		if not widget.Enabled then
			cogHovered = false
			paintCog()
		end
	end)

	for index, name in PAGES do
		local tabButton = create("TextButton", {
			LayoutOrder = index,
			Size = UDim2.new(1 / #PAGES, 0, 1, 0),
			BackgroundTransparency = 1,
			AutoButtonColor = false,
			Font = Enum.Font.BuilderSansBold,
			TextSize = 15,
			Text = name,
		}, tabBar)
		local underline = create("Frame", {AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, 0), Size = UDim2.new(0.6, 0, 0, 3), BorderSizePixel = 0}, tabButton)

		rounded(underline, 2)
		tabs[name] = {button = tabButton, underline = underline}
		tabButton.MouseButton1Click:Connect(function()
			openPage(name)
		end)
	end

	holder.show = function(name)
		if pages[name] then
			openPage(name)
		end
	end

	local statusPage = create("Frame", {Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1}, content)

	pages.Status = statusPage
	create("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, statusPage)

	local grid = create("Frame", {Size = UDim2.new(1, 0, 0, 170), BackgroundTransparency = 1}, statusPage)

	create("UIGridLayout", {CellSize = UDim2.new(0.5, -7, 0, 78), CellPadding = UDim2.fromOffset(14, 14), SortOrder = Enum.SortOrder.LayoutOrder}, grid)

	local function tile(order, caption)
		local cardFrame = create("Frame", {LayoutOrder = order, BorderSizePixel = 0}, grid)

		rounded(cardFrame, 10)

		local value = label(cardFrame, {Position = UDim2.fromOffset(12, 10), Size = UDim2.new(1, -24, 0, 30), Font = Enum.Font.BuilderSansBold, TextSize = 24})
		local caption2 = label(cardFrame, {Position = UDim2.fromOffset(12, 46), Size = UDim2.new(1, -24, 0, 20), TextSize = 13, Text = caption})

		onTheme(function()
			cardFrame.BackgroundColor3 = card()
			caption2.TextColor3 = dimText()
		end)

		return value, caption2
	end

	local commandsValue = tile(1, "commands run")
	local failedValue = tile(2, "failed")
	local lastValue, lastCaption = tile(3, "last command")
	local uptimeValue = tile(4, "plugin uptime")
	local infoLabel = label(statusPage, {Position = UDim2.fromOffset(0, 184), Size = UDim2.new(1, 0, 0, 90), TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None, TextYAlignment = Enum.TextYAlignment.Top})

	toolsPage = create("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
	}, content)

	pages.Tools = toolsPage
	create("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 20)}, toolsPage)
	create("UIListLayout", {Padding = UDim.new(0, 12), SortOrder = Enum.SortOrder.LayoutOrder}, toolsPage)

	local summary = create("Frame", {LayoutOrder = 1, Size = UDim2.new(1, 0, 0, 72), BorderSizePixel = 0}, toolsPage)

	rounded(summary, 10)

	local totalLabel = label(summary, {Position = UDim2.fromOffset(14, 10), Size = UDim2.new(1, -28, 0, 30), Font = Enum.Font.BuilderSansBold, TextSize = 24, Text = "Loading"})
	local totalNote = label(summary, {Position = UDim2.fromOffset(14, 42), Size = UDim2.new(1, -28, 0, 20), TextSize = 13})
	local messageLabel = label(toolsPage, {LayoutOrder = 2, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None})
	local presetsTitle = label(toolsPage, {LayoutOrder = 3, Size = UDim2.new(1, 0, 0, 20), Font = Enum.Font.BuilderSansBold, TextSize = 15, Text = "Presets"})
	local presetsFrame = create("Frame", {LayoutOrder = 4, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1}, toolsPage)

	create("UIListLayout", {FillDirection = Enum.FillDirection.Horizontal, Wraps = true, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder}, presetsFrame)

	local groupsTitle = label(toolsPage, {LayoutOrder = 5, Size = UDim2.new(1, 0, 0, 20), Font = Enum.Font.BuilderSansBold, TextSize = 15, Text = "Groups"})
	local groupsFrame = create("Frame", {LayoutOrder = 6, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1}, toolsPage)

	create("UIListLayout", {Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder}, groupsFrame)

	local profileData = nil
	local toolsMessage = ""
	local renderTools

	local function enabledGroups()
		local set = {core = true}

		if not profileData then
			return set
		end

		local profile = normalizeProfile(profileData.profile)

		if profile == "all" then
			for _, group in profileData.groups do
				set[group.name] = true
			end
		else
			for name in string.gmatch(profile, "[^,]+") do
				set[name] = true
			end
		end

		return set
	end

	local function decodeBody(ok, response)
		if not ok or not response or type(response.Body) ~= "string" then
			return nil
		end

		local parsed, value = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)

		return if parsed and type(value) == "table" then value else nil
	end

	local function applyProfile(profile)
		toolsMessage = "Saving..."
		renderTools()

		task.spawn(function()
			local ok, response = post("/profile", {action = "set", profile = profile})
			local decoded = decodeBody(ok, response)

			if decoded and decoded.groups then
				profileData = decoded
				toolsMessage = "Saved. Your AI client may need /mcp to refresh its tool list."
			else
				toolsMessage = "Not saved: " .. ((decoded and decoded.error) or "the bridge did not answer")
			end

			renderTools()
		end)
	end

	local function toggleGroup(name)
		local set = enabledGroups()

		set[name] = not set[name]

		local chosen = {}
		local optional = 0

		for _, group in profileData.groups do
			if group.name ~= "core" then
				optional += 1

				if set[group.name] then
					table.insert(chosen, group.name)
				end
			end
		end

		applyProfile(if #chosen == optional then "all" elseif #chosen == 0 then "core" else table.concat(chosen, ","))
	end

	local function clearChildren(container)
		for _, child in container:GetChildren() do
			if child:IsA("GuiObject") then
				child:Destroy()
			end
		end
	end

	renderTools = function()
		local keepScroll = toolsPage.CanvasPosition

		clearChildren(presetsFrame)
		clearChildren(groupsFrame)

		summary.BackgroundColor3 = card()
		totalLabel.TextColor3 = mainText()
		totalNote.TextColor3 = dimText()
		presetsTitle.TextColor3 = mainText()
		groupsTitle.TextColor3 = mainText()
		messageLabel.TextColor3 = dimText()

		if not profileData then
			totalLabel.Text = "Loading..."
			totalNote.Text = "Waiting for the bridge"
			messageLabel.Text = toolsMessage

			return
		end

		local locked = profileData.locked == true

		totalLabel.Text = string.format("%d tools offered", profileData.total.tools)
		totalNote.Text = string.format("about %s tokens of context", tokenText(profileData.total.tokens))
		messageLabel.Text = if locked then "The tool profile is fixed by the STUDIO_BRIDGE_TOOLS environment variable, so these switches are read-only." else toolsMessage

		local current = normalizeProfile(profileData.profile)

		for index, preset in profileData.presets do
			local active = normalizeProfile(preset.profile) == current
			local chip = create("TextButton", {
				LayoutOrder = index,
				AutomaticSize = Enum.AutomaticSize.X,
				Size = UDim2.fromOffset(0, 30),
				BorderSizePixel = 0,
				AutoButtonColor = not locked,
				BackgroundColor3 = if active then ACCENT else card(),
				TextColor3 = if active then ON_ACCENT else mainText(),
				Font = Enum.Font.BuilderSansBold,
				TextSize = 14,
				Text = preset.name,
			}, presetsFrame)

			rounded(chip, 15)
			create("UIPadding", {PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, chip)

			if not locked then
				chip.MouseButton1Click:Connect(function()
					applyProfile(preset.profile)
				end)
			end
		end

		local enabled = enabledGroups()

		for index, group in profileData.groups do
			local on = enabled[group.name] == true
			local isCore = group.name == "core"
			local row = create("Frame", {LayoutOrder = index, Size = UDim2.new(1, 0, 0, 72), BorderSizePixel = 0, BackgroundColor3 = card()}, groupsFrame)

			rounded(row, 10)

			local track = create("TextButton", {
				Position = UDim2.fromOffset(14, 26),
				Size = UDim2.fromOffset(40, 22),
				BorderSizePixel = 0,
				AutoButtonColor = false,
				Text = "",
				BackgroundColor3 = if on then ACCENT else line(),
				BackgroundTransparency = if isCore or locked then 0.55 else 0,
			}, row)

			rounded(track, 11)

			local knob = create("Frame", {
				Position = if on then UDim2.fromOffset(21, 3) else UDim2.fromOffset(3, 3),
				Size = UDim2.fromOffset(16, 16),
				BorderSizePixel = 0,
				BackgroundColor3 = Color3.fromRGB(255, 255, 255),
			}, track)

			rounded(knob, 8)

			label(row, {
				Position = UDim2.fromOffset(68, 8),
				Size = UDim2.new(1, -80, 0, 20),
				Font = Enum.Font.BuilderSansBold,
				TextSize = 15,
				TextColor3 = mainText(),
				Text = string.format('%s%s  <font color="%s">%d tools  ·  about %s tokens%s</font>', group.title, (({pro = '  <font color="#ffd166"><b>PRO</b></font>', official = '  <font color="#4fd8ff">official</font>', unverified = '  <font color="#ff9f43">unverified</font>'})[group.tier or ""] or ""), hexOf(dimText()), group.tools, tokenText(group.tokens), if isCore then "  ·  always on" else ""),
			})
			label(row, {
				Position = UDim2.fromOffset(68, 30),
				Size = UDim2.new(1, -80, 0, 36),
				TextSize = 12,
				TextColor3 = dimText(),
				TextWrapped = true,
				TextTruncate = Enum.TextTruncate.None,
				TextYAlignment = Enum.TextYAlignment.Top,
				Text = group.summary,
			})

			if not isCore and not locked then
				track.MouseButton1Click:Connect(function()
					toggleGroup(group.name)
				end)
			end
		end

		task.defer(function()
			toolsPage.CanvasPosition = keepScroll
		end)
	end

	table.insert(themed, function()
		renderTools()
	end)

	loadProfile = function()
		task.spawn(function()
			local ok, response = post("/profile", {action = "get"})
			local decoded = decodeBody(ok, response)

			if decoded and decoded.groups then
				profileData = decoded
			end

			renderTools()
		end)
	end

	proPage = create("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
	}, content)

	pages.Pro = proPage
	create("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 20)}, proPage)
	create("UIListLayout", {Padding = UDim.new(0, 12), SortOrder = Enum.SortOrder.LayoutOrder}, proPage)

	local proTitle = label(proPage, {LayoutOrder = 1, Size = UDim2.new(1, 0, 0, 26), Font = Enum.Font.BuilderSansBold, TextSize = 20, Text = 'Studio Bridge  <font color="#ffd166"><b>PRO</b></font>'})
	local proIntro = label(proPage, {LayoutOrder = 2, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None, Text = "Paste your license key to download and unlock the paid packs. The key is saved on this computer only."})
	local keyCard = create("Frame", {LayoutOrder = 3, Size = UDim2.new(1, 0, 0, 40), BorderSizePixel = 0}, proPage)

	rounded(keyCard, 8)

	local keyBox = create("TextBox", {
		Position = UDim2.fromOffset(12, 0),
		Size = UDim2.new(1, -24, 1, 0),
		BackgroundTransparency = 1,
		ClearTextOnFocus = false,
		Font = Enum.Font.RobotoMono,
		TextSize = 13,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextTruncate = Enum.TextTruncate.AtEnd,
		PlaceholderText = "Paste your license key here",
		Text = "",
	}, keyCard)
	local activateButton = create("TextButton", {LayoutOrder = 4, Size = UDim2.new(1, 0, 0, 38), BorderSizePixel = 0, AutoButtonColor = true, Font = Enum.Font.BuilderSansBold, TextSize = 15, Text = "Activate"}, proPage)

	rounded(activateButton, 8)

	local buyButton = create("TextButton", {LayoutOrder = 5, Size = UDim2.new(1, 0, 0, 34), BorderSizePixel = 0, AutoButtonColor = true, Font = Enum.Font.BuilderSansBold, TextSize = 14, Text = "Buy a license"}, proPage)

	rounded(buyButton, 8)

	local proMessage = label(proPage, {LayoutOrder = 6, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None})
	local proStatusCard = create("Frame", {LayoutOrder = 7, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BorderSizePixel = 0}, proPage)

	rounded(proStatusCard, 10)
	create("UIPadding", {PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 12), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, proStatusCard)

	local proStatusText = label(proStatusCard, {Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None, TextYAlignment = Enum.TextYAlignment.Top})
	local removeButton = create("TextButton", {LayoutOrder = 8, Size = UDim2.new(1, 0, 0, 32), BorderSizePixel = 0, AutoButtonColor = true, Font = Enum.Font.BuilderSans, TextSize = 13, Text = "Remove the license from this computer", Visible = false}, proPage)

	rounded(removeButton, 8)

	local proData
	local proBusy = false

	local function plain(text)
		return (string.gsub(string.gsub(string.gsub(tostring(text), "&", "&amp;"), "<", "&lt;"), ">", "&gt;"))
	end

	local trustNames = {official = "official", pro = "official Pro"}

	local function renderPro()
		if not proData then
			proStatusText.Text = "Checking this computer..."
			removeButton.Visible = false

			return
		end

		if proData.hasKey then
			local packs = {}

			for _, pack in proData.packs or {} do
				table.insert(packs, string.format("%s %s  (%s)", plain(pack.title), plain(pack.version), trustNames[pack.trust] or "unverified third-party"))
			end

			proStatusText.Text = string.format(
				"License  <b>%s</b>\nPlan  %s\nPacks  %s",
				plain(proData.maskedKey or ""),
				plain(proData.plan or "not checked yet"),
				if #packs > 0 then table.concat(packs, ", ") else "none installed"
			)
			removeButton.Visible = true
		else
			proStatusText.Text = "No license key is saved on this computer."
			removeButton.Visible = false
		end
	end

	local function showProMessage(text, good)
		proMessage.Text = plain(text)
		proMessage.TextColor3 = if good then GOOD else BAD
	end

	onTheme(function()
		proTitle.TextColor3 = mainText()
		proIntro.TextColor3 = dimText()
		keyCard.BackgroundColor3 = card()
		keyBox.TextColor3 = mainText()
		keyBox.PlaceholderColor3 = dimText()
		activateButton.BackgroundColor3 = ACCENT
		activateButton.TextColor3 = ON_ACCENT
		buyButton.BackgroundColor3 = card()
		buyButton.TextColor3 = GOLD
		proStatusCard.BackgroundColor3 = card()
		proStatusText.TextColor3 = mainText()
		removeButton.BackgroundColor3 = card()
		removeButton.TextColor3 = dimText()
	end)

	loadPro = function()
		task.spawn(function()
			local ok, response = post("/pro", {action = "status"})
			local decoded = decodeBody(ok, response)

			if decoded and decoded.ok then
				proData = decoded
			end

			renderPro()
		end)
	end

	activateButton.MouseButton1Click:Connect(function()
		if proBusy then
			return
		end

		local key = string.gsub(keyBox.Text, "%s+", "")

		if key == "" then
			showProMessage("Paste your license key first.", false)

			return
		end

		proBusy = true
		activateButton.Text = "Activating..."
		showProMessage("", true)

		task.spawn(function()
			local ok, response = post("/pro", {action = "activate", key = key})
			local decoded = decodeBody(ok, response)

			proBusy = false
			activateButton.Text = "Activate"

			if decoded and decoded.status then
				proData = decoded.status
				proData.ok = true
			end

			if decoded and decoded.ok then
				keyBox.Text = ""
				showProMessage(decoded.message or "License accepted.", true)
			elseif decoded then
				showProMessage(decoded.message or "The license could not be activated.", false)
			else
				showProMessage("Could not reach the Studio Bridge program. Check that your AI tool has started it.", false)
			end

			renderPro()
		end)
	end)

	buyButton.MouseButton1Click:Connect(function()
		task.spawn(function()
			local ok, response = post("/pro", {action = "buy"})
			local decoded = decodeBody(ok, response)

			if decoded and decoded.message then
				showProMessage(decoded.message, decoded.ok == true)
			elseif decoded then
				showProMessage("This Studio Bridge program is older than the plugin and cannot open the license page. Restart your AI tool to update it.", false)
			else
				showProMessage("Could not reach the Studio Bridge program. Check that your AI tool has started it.", false)
			end
		end)
	end)

	removeButton.MouseButton1Click:Connect(function()
		if proBusy then
			return
		end

		proBusy = true
		removeButton.Text = "Removing..."

		task.spawn(function()
			local ok, response = post("/pro", {action = "remove"})
			local decoded = decodeBody(ok, response)

			proBusy = false
			removeButton.Text = "Remove the license from this computer"

			if decoded and decoded.status then
				proData = decoded.status
				proData.ok = true
			end

			showProMessage(if decoded then (decoded.message or "License removed.") else "Could not reach the Studio Bridge program.", decoded ~= nil and decoded.ok == true)
			renderPro()
		end)
	end)

	local configPage = create("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
	}, content)

	pages.Config = configPage
	create("UIPadding", {PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 20)}, configPage)
	create("UIListLayout", {Padding = UDim.new(0, 12), SortOrder = Enum.SortOrder.LayoutOrder}, configPage)

	local configTitle = label(configPage, {LayoutOrder = 1, Size = UDim2.new(1, 0, 0, 26), Font = Enum.Font.BuilderSansBold, TextSize = 20, Text = "Config"})
	local configIntro = label(configPage, {LayoutOrder = 2, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None, Text = "Switch these here instead of asking your AI. They are saved on this computer."})
	local configMessage = label(configPage, {LayoutOrder = 3, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextSize = 13, TextWrapped = true, TextTruncate = Enum.TextTruncate.None})
	local configRows = create("Frame", {LayoutOrder = 4, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1}, configPage)

	create("UIListLayout", {Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder}, configRows)

	local configData = nil
	local configNote = ""
	local configBusy = false
	local renderConfig

	local function configSwitches(data)
		local source = if data.updateMode == "source" then " This copy runs from source, so it cannot update itself." else ""

		return {
			{key = "checkUpdates", title = "Check for updates", text = "Look for a newer release once a day when the bridge starts. Nothing is downloaded.", on = data.checkUpdates},
			{key = "autoUpdate", title = "Install updates automatically", text = "Download, verify and install new releases yourself. They take effect at the next restart." .. source, on = data.autoUpdate},
			{key = "packTrust", title = "Only load signed packs", text = "On: only packs signed by Studio Bridge load. Off: unsigned third-party packs load too, labeled unverified.", on = data.packTrust == "verified"},
		}
	end

	local function setConfig(key, value)
		if configBusy then
			return
		end

		configBusy = true
		configNote = "Saving..."
		renderConfig()

		task.spawn(function()
			local ok, response = post("/settings", {action = "set", name = key, value = value})
			local decoded = decodeBody(ok, response)

			configBusy = false

			if decoded and decoded.packTrust then
				configData = decoded
				configNote = if key == "packTrust" then "Saved. Your AI client may need /mcp to refresh its tool list." else "Saved."
			elseif decoded and decoded.error then
				configNote = "Not saved: " .. decoded.error
			else
				configNote = "Not saved: the bridge did not answer. If your AI tool was just updated, restart it."
			end

			renderConfig()
		end)
	end

	renderConfig = function()
		local keepScroll = configPage.CanvasPosition

		clearChildren(configRows)

		configTitle.TextColor3 = mainText()
		configIntro.TextColor3 = dimText()
		configMessage.TextColor3 = dimText()

		if not configData then
			configMessage.Text = if configNote ~= "" then configNote else "Waiting for the bridge..."

			return
		end

		local notes = {}

		if configNote ~= "" then
			table.insert(notes, configNote)
		end

		if configData.unreadable then
			table.insert(notes, "The settings file could not be read, so only signed packs are loaded. Saving a switch keeps a copy of the broken file and replaces it.")
		end

		if configData.update and configData.update.applied then
			table.insert(notes, string.format("Studio Bridge %s was installed. Restart your AI tool to use it.", plain(configData.update.applied)))
		elseif configData.update and configData.update.newer then
			table.insert(notes, string.format("Update available: %s (you have %s). Ask your AI to run bridge_update, or run studio-bridge update.", plain(configData.update.tag), plain(configData.version)))
		end

		configMessage.Text = table.concat(notes, "\n")

		for index, switch in configSwitches(configData) do
			local row = create("Frame", {LayoutOrder = index, Size = UDim2.new(1, 0, 0, 84), BorderSizePixel = 0, BackgroundColor3 = card()}, configRows)

			rounded(row, 10)

			local track = create("TextButton", {
				Position = UDim2.fromOffset(14, 31),
				Size = UDim2.fromOffset(40, 22),
				BorderSizePixel = 0,
				AutoButtonColor = false,
				Text = "",
				BackgroundColor3 = if switch.on then ACCENT else line(),
			}, row)

			rounded(track, 11)

			create("Frame", {
				Position = if switch.on then UDim2.fromOffset(21, 3) else UDim2.fromOffset(3, 3),
				Size = UDim2.fromOffset(16, 16),
				BorderSizePixel = 0,
				BackgroundColor3 = Color3.fromRGB(255, 255, 255),
			}, track)
			rounded(track:FindFirstChildOfClass("Frame"), 8)
			label(row, {Position = UDim2.fromOffset(68, 8), Size = UDim2.new(1, -80, 0, 20), Font = Enum.Font.BuilderSansBold, TextSize = 15, TextColor3 = mainText(), Text = switch.title})
			label(row, {
				Position = UDim2.fromOffset(68, 30),
				Size = UDim2.new(1, -80, 0, 48),
				TextSize = 12,
				TextColor3 = dimText(),
				TextWrapped = true,
				TextTruncate = Enum.TextTruncate.None,
				TextYAlignment = Enum.TextYAlignment.Top,
				Text = switch.text,
			})
			track.MouseButton1Click:Connect(function()
				if switch.key == "packTrust" then
					setConfig(switch.key, if switch.on then "all" else "verified")
				else
					setConfig(switch.key, not switch.on)
				end
			end)
		end

		local toolsRow = create("Frame", {LayoutOrder = 4, Size = UDim2.new(1, 0, 0, 84), BorderSizePixel = 0, BackgroundColor3 = card()}, configRows)

		rounded(toolsRow, 10)
		label(toolsRow, {Position = UDim2.fromOffset(14, 8), Size = UDim2.new(1, -28, 0, 20), Font = Enum.Font.BuilderSansBold, TextSize = 15, TextColor3 = mainText(), Text = "Tool groups"})
		label(toolsRow, {
			Position = UDim2.fromOffset(14, 30),
			Size = UDim2.new(1, -28, 0, 20),
			TextSize = 12,
			TextColor3 = dimText(),
			Text = string.format("Offered now: %s%s", plain(configData.profile), if configData.profileLocked then "  ·  fixed by STUDIO_BRIDGE_TOOLS" else ""),
		})

		local openTools = create("TextButton", {
			Position = UDim2.fromOffset(14, 52),
			Size = UDim2.fromOffset(150, 24),
			BorderSizePixel = 0,
			BackgroundColor3 = line(),
			TextColor3 = mainText(),
			Font = Enum.Font.BuilderSansBold,
			TextSize = 13,
			Text = "Open the Tools tab",
		}, toolsRow)

		rounded(openTools, 12)
		openTools.MouseButton1Click:Connect(function()
			holder.show("Tools")
		end)

		task.defer(function()
			configPage.CanvasPosition = keepScroll
		end)
	end

	table.insert(themed, function()
		renderConfig()
	end)

	loadConfig = function()
		task.spawn(function()
			local ok, response = post("/settings", {action = "get"})
			local decoded = decodeBody(ok, response)

			if decoded and decoded.packTrust then
				configData = decoded
				configNote = ""
			end

			renderConfig()
		end)
	end

	local logPage = create("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
	}, content)

	pages.Log = logPage
	create("UIPadding", {PaddingTop = UDim.new(0, 12), PaddingBottom = UDim.new(0, 12), PaddingLeft = UDim.new(0, 14), PaddingRight = UDim.new(0, 14)}, logPage)

	local logText = create("TextLabel", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundTransparency = 1,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true,
		Font = Enum.Font.RobotoMono,
		TextSize = 12,
		Text = "",
	}, logPage)

	onTheme(function()
		logText.TextColor3 = dimText()
		infoLabel.TextColor3 = dimText()
		commandsValue.TextColor3 = mainText()
		lastValue.TextColor3 = mainText()
		uptimeValue.TextColor3 = mainText()
		failedValue.TextColor3 = if status.failures > 0 then BAD else mainText()
		paintTabs()
	end)

	local shownLog = -1

	local function refresh()
		local state = STATES[status.state] or STATES.offline

		dot.BackgroundColor3 = state[2]
		pillText.Text = state[1] .. (if status.state == "connected" and status.transport then "  ·  " .. status.transport else "")
		subtitle.Text = (if profileData and profileData.version then "bridge v" .. profileData.version .. "  ·  " else "") .. ROLE .. " window"
		commandsValue.Text = tostring(status.commands)
		failedValue.Text = tostring(status.failures)
		failedValue.TextColor3 = if status.failures > 0 then BAD else mainText()
		lastValue.Text = status.lastCommand or "none yet"
		lastCaption.Text = if status.lastCommand then "last command  ·  " .. elapsed(math.floor(os.clock() - status.lastCommandAt)) .. " ago" else "last command"
		uptimeValue.Text = elapsed(math.floor(os.clock() - status.startedAt))
		infoLabel.Text = if status.detail ~= "" then status.detail else "Commands from your AI assistant run here. Open the Tools tab to choose which tool groups it can use."

		if #status.log ~= shownLog then
			shownLog = #status.log
			logText.Text = if shownLog == 0 then "No events yet." else table.concat(status.log, "\n")
			logPage.CanvasPosition = Vector2.new(0, 1000000)
		end
	end

	holder.theme = studioSettings.ThemeChanged:Connect(function()
		for _, apply in themed do
			apply()
		end
	end)

	selected = "Status"
	paintTabs()
	refresh()
	loadProfile()

	task.spawn(function()
		while not stopped do
			if widget.Enabled then
				pcall(refresh)
			end

			task.wait(1)
		end
	end)

	return {
		destroy = function()
			if holder.click then
				holder.click:Disconnect()
				holder.click = nil
			end

			if holder.theme then
				holder.theme:Disconnect()
				holder.theme = nil
			end
		end,
	}
end

if ROLE == "edit" and studioPlugin then
	local built, result = pcall(buildStatusWidget)

	if built then
		statusUi = result
	else
		warn("[Studio Bridge:" .. ROLE .. "] status window unavailable: " .. tostring(result))
	end
end

local function stop()
	stopped = true

	if statusUi then
		statusUi.destroy()
		statusUi = nil
	end

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
