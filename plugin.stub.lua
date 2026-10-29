local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local ROLE = if not RunService:IsRunning() then "edit" elseif RunService:IsServer() then "server" else "client"

local URL = "http://127.0.0.1:__PORT__"
local TOKEN = "__TOKEN__"
local CLIENT_ID = HttpService:GenerateGUID(false)
local RETRY_SECONDS = 3
local RELOAD_CHECK_SECONDS = 10
local RELAY_NAME = "__BridgeRelay"
local RELAY_FETCH_SECONDS = 15

local K = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}

local MASK = 0xffffffff

local function sha256Raw(message)
	local bits = #message * 8
	local padded = message .. "\128" .. string.rep("\0", (55 - #message) % 64) .. string.pack(">I4I4", math.floor(bits / 4294967296), bits % 4294967296)

	local h0, h1, h2, h3 = 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a
	local h4, h5, h6, h7 = 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
	local w = table.create(64, 0)

	for chunk = 1, #padded, 64 do
		for index = 1, 16 do
			w[index] = string.unpack(">I4", padded, chunk + (index - 1) * 4)
		end

		for index = 17, 64 do
			local a = w[index - 15]
			local b = w[index - 2]
			local s0 = bit32.bxor(bit32.rrotate(a, 7), bit32.rrotate(a, 18), bit32.rshift(a, 3))
			local s1 = bit32.bxor(bit32.rrotate(b, 17), bit32.rrotate(b, 19), bit32.rshift(b, 10))

			w[index] = bit32.band(w[index - 16] + s0 + w[index - 7] + s1, MASK)
		end

		local a, b, c, d, e, f, g, h = h0, h1, h2, h3, h4, h5, h6, h7

		for index = 1, 64 do
			local s1 = bit32.bxor(bit32.rrotate(e, 6), bit32.rrotate(e, 11), bit32.rrotate(e, 25))
			local choice = bit32.bxor(bit32.band(e, f), bit32.band(bit32.bnot(e), g))
			local temp1 = h + s1 + choice + K[index] + w[index]
			local s0 = bit32.bxor(bit32.rrotate(a, 2), bit32.rrotate(a, 13), bit32.rrotate(a, 22))
			local majority = bit32.bxor(bit32.band(a, b), bit32.band(a, c), bit32.band(b, c))
			local temp2 = s0 + majority

			h = g
			g = f
			f = e
			e = bit32.band(d + temp1, MASK)
			d = c
			c = b
			b = a
			a = bit32.band(temp1 + temp2, MASK)
		end

		h0 = bit32.band(h0 + a, MASK)
		h1 = bit32.band(h1 + b, MASK)
		h2 = bit32.band(h2 + c, MASK)
		h3 = bit32.band(h3 + d, MASK)
		h4 = bit32.band(h4 + e, MASK)
		h5 = bit32.band(h5 + f, MASK)
		h6 = bit32.band(h6 + g, MASK)
		h7 = bit32.band(h7 + h, MASK)
	end

	return string.pack(">I4I4I4I4I4I4I4I4", h0, h1, h2, h3, h4, h5, h6, h7)
end

local function toHex(raw)
	return (string.gsub(raw, ".", function(char)
		return string.format("%02x", string.byte(char))
	end))
end

local function hmacSha256Hex(key, message)
	if #key > 64 then
		key = sha256Raw(key)
	end

	key ..= string.rep("\0", 64 - #key)

	local inner = table.create(64)
	local outer = table.create(64)

	for index = 1, 64 do
		local byte = string.byte(key, index)

		inner[index] = string.char(bit32.bxor(byte, 0x36))
		outer[index] = string.char(bit32.bxor(byte, 0x5c))
	end

	return toHex(sha256Raw(table.concat(outer) .. sha256Raw(table.concat(inner) .. message)))
end

local function constantTimeEquals(a, b)
	if #a ~= #b then
		return false
	end

	local difference = 0

	for index = 1, #a do
		difference = bit32.bor(difference, bit32.bxor(string.byte(a, index), string.byte(b, index)))
	end

	return difference == 0
end

local function compile(code)
	local available, fn, compileError = pcall(loadstring, code, "=Studio Bridge")

	if available then
		return fn, compileError
	end

	local module = Instance.new("ModuleScript")

	module.Name = "__BridgeStubChunk"
	module.Source = "return function(...) " .. code .. "\nend"

	local loaded, built = pcall(require, module)

	module:Destroy()

	if not loaded then
		return nil, tostring(built)
	end

	return built
end

local lastProblem

local function report(problem)
	if problem ~= lastProblem then
		lastProblem = problem
		warn("[Studio Bridge:" .. ROLE .. "] " .. problem)
	end
end

local function verifyBody(body)
	if type(body) ~= "table" or type(body.version) ~= "string" then
		return nil, "the bridge sent an unreadable plugin response"
	end

	if body.unchanged then
		return body
	end

	if type(body.source) ~= "string" or type(body.signature) ~= "string" then
		return nil, "the bridge sent a plugin response without source or signature"
	end

	if not constantTimeEquals(hmacSha256Hex(TOKEN, body.source), string.lower(body.signature)) then
		return nil, "the plugin source failed its signature check, so it was not run"
	end

	return body
end

local function fetch(haveVersion, role)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = URL .. "/plugin",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Bridge-Token"] = TOKEN,
			},
			Body = HttpService:JSONEncode({have = haveVersion, role = role or ROLE}),
		})
	end)

	if not ok then
		return nil, "cannot reach the bridge to load the plugin: " .. tostring(response)
	end

	if not response.Success then
		local explained, refusal = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)

		if explained and type(refusal) == "table" and type(refusal.message) == "string" then
			return nil, refusal.message
		end

		return nil, "the bridge refused the plugin request: HTTP " .. tostring(response.StatusCode)
	end

	local decoded, body = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not decoded then
		return nil, "the bridge sent an unreadable plugin response"
	end

	return verifyBody(body)
end

local function fetchViaRelay()
	local remote = game:GetService("ReplicatedStorage"):WaitForChild(RELAY_NAME, 60)

	if not remote then
		return nil, "the bridge relay did not appear in this play session"
	end

	local finished = false
	local answer

	task.spawn(function()
		local ok, value = pcall(function()
			return remote:InvokeServer("plugin")
		end)

		if ok then
			answer = value
		end

		finished = true
	end)

	local deadline = os.clock() + RELAY_FETCH_SECONDS

	while not finished and os.clock() < deadline do
		task.wait(0.1)
	end

	if answer == nil then
		return nil, "the play server did not hand over the plugin"
	end

	return verifyBody(answer)
end

local current

local function load(body)
	local fn, compileError = compile(body.source)

	if not fn then
		report("the plugin source did not compile: " .. tostring(compileError))

		return false
	end

	if current and type(current.api.stop) == "function" then
		pcall(current.api.stop)
	end

	current = nil

	local ran, api = pcall(fn, {clientId = CLIENT_ID, version = body.version, clientBody = body.clientBody})

	if not ran then
		report("the plugin failed to start: " .. tostring(api))

		return false
	end

	current = {version = body.version, api = if type(api) == "table" then api else {}}
	lastProblem = nil

	return true
end

local function idle()
	local api = current and current.api

	if api and type(api.busy) == "function" then
		local ok, busy = pcall(api.busy)

		return ok and not busy
	end

	return true
end

task.spawn(function()
	while true do
		local body, problem

		if ROLE == "client" then
			body, problem = fetchViaRelay()
		else
			body, problem = fetch(current and current.version)
		end

		if not body then
			report(problem)
			task.wait(RETRY_SECONDS)
		else
			if not body.unchanged and (not current or idle()) then
				if ROLE == "server" then
					body.clientBody = (fetch(nil, "client"))
				end

				load(body)
			end

			if ROLE ~= "edit" and current then
				return
			end

			task.wait(RELOAD_CHECK_SECONDS)
		end
	end
end)
