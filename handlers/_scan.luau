local SCAN_RULES = {
	{severity = "high", label = "require by asset id", pattern = "require%s*%(%s*%d+%s*%)"},
	{severity = "high", label = "require by asset id", pattern = "require%s*%(%s*[%w_%.]*[Ii]d%s*%)"},
	{severity = "high", label = "loadstring", pattern = "loadstring"},
	{severity = "high", label = "InsertService LoadAsset", pattern = "LoadAsset"},
	{severity = "high", label = "getfenv/setfenv", pattern = "[gs]etfenv"},
	{severity = "high", label = "string.reverse", pattern = "string%.reverse%s*%("},
	{severity = "high", label = "obfuscated escape run", pattern = "\\%d%d%d\\%d%d%d\\%d%d%d\\%d%d%d"},
	{severity = "high", label = "obfuscated hex run", pattern = "\\x%x%x\\x%x%x\\x%x%x\\x%x%x"},
	{severity = "medium", label = "HttpService request", pattern = "RequestAsync"},
	{severity = "medium", label = "HttpService GetAsync", test = function(line)
		return string.find(line, "[Hh]ttp[%w_]*[:%.]GetAsync%s*%(") ~= nil
	end},
	{severity = "medium", label = "HttpService PostAsync", test = function(line)
		return string.find(line, "[Hh]ttp[%w_]*[:%.]PostAsync%s*%(") ~= nil
	end},
	{severity = "medium", label = "MessagingService", pattern = "MessagingService"},
	{severity = "medium", label = "TeleportService", pattern = "TeleportService"},
	{severity = "medium", label = "purchase prompt", pattern = "Prompt%a*Purchase"},
	{severity = "medium", label = "DataStore access", pattern = "DataStoreService"},
	{severity = "medium", label = "kicks players", pattern = ":Kick%s*%("},
	{severity = "medium", label = "ban api", pattern = "BanAsync"},
	{severity = "low", label = "long base64-looking string", test = function(line)
		return string.find(line, "[%w%+/=]+") ~= nil and #line > 200 and string.find(string.gsub(line, "[%w%+/=]", ""), "^%s*$") ~= nil
	end},
	{severity = "low", label = "very long single line", test = function(line)
		return #line > 1500
	end},
}

local SEVERITY_ORDER = {high = 1, medium = 2, low = 3}

local function scanScripts(root, maxFindings)
	local candidates = root:GetDescendants()

	table.insert(candidates, 1, root)

	local findings = {}
	local scanned = 0

	for _, instance in ipairs(candidates) do
		if instance:IsA("LuaSourceContainer") then
			scanned += 1

			local source = readSource(instance)
			local lines = string.split(source, "\n")
			local seen = {}

			for number, line in ipairs(lines) do
				for _, rule in ipairs(SCAN_RULES) do
					local key = rule.label .. "|" .. number

					local hit = if rule.test then rule.test(line) else string.find(line, rule.pattern) ~= nil

					if not seen[key] and hit then
						seen[key] = true
						table.insert(findings, {
							severity = rule.severity,
							label = rule.label,
							path = pathOf(instance),
							line = number,
							text = string.sub(string.gsub(line, "^%s+", ""), 1, 120),
						})
					end
				end
			end
		end
	end

	table.sort(findings, function(a, b)
		if a.severity ~= b.severity then
			return SEVERITY_ORDER[a.severity] < SEVERITY_ORDER[b.severity]
		end

		if a.path ~= b.path then
			return a.path < b.path
		end

		return a.line < b.line
	end)

	local counts = {high = 0, medium = 0, low = 0}

	for _, finding in ipairs(findings) do
		counts[finding.severity] += 1
	end

	local out = {string.format("scanned %d script(s): %d high, %d medium, %d low", scanned, counts.high, counts.medium, counts.low)}

	for index, finding in ipairs(findings) do
		if index > maxFindings then
			table.insert(out, string.format("[stopped at max_findings=%d]", maxFindings))
			break
		end

		table.insert(out, string.format("%s | %s | %s:%d | %s", string.upper(finding.severity), finding.label, finding.path, finding.line, finding.text))
	end

	return table.concat(out, "\n")
end
