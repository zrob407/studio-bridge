if type(params.pattern) ~= "string" or params.pattern == "" then
	error("pattern is required")
end

local root = if params.root then resolve(params.root) else game
local plain = params.plain ~= false
local caseSensitive = params.case_sensitive == true
local context = params.context_lines or 0
local limit = params.max_results or 100
local needle = if caseSensitive then params.pattern else string.lower(params.pattern)

local candidates = root:GetDescendants()

if root:IsA("LuaSourceContainer") then
	table.insert(candidates, 1, root)
end

local out = {}
local matches = 0
local scriptsWithMatches = 0
local truncated = false

for _, instance in ipairs(candidates) do
	if instance:IsA("LuaSourceContainer") then
		local lines = string.split(readSource(instance), "\n")
		local hits = {}

		for number, line in ipairs(lines) do
			local haystack = if caseSensitive then line else string.lower(line)

			if string.find(haystack, needle, 1, plain) then
				table.insert(hits, number)
			end
		end

		if #hits > 0 then
			scriptsWithMatches += 1
			table.insert(out, pathOf(instance) .. " (" .. #hits .. ")")

			for _, number in ipairs(hits) do
				matches += 1

				if matches > limit then
					truncated = true
					break
				end

				for shown = math.max(1, number - context), math.min(#lines, number + context) do
					local marker = if shown == number then ":" else "-"
					table.insert(out, "  " .. shown .. marker .. " " .. lines[shown])
				end
			end

			if truncated then
				break
			end
		end
	end
end

if #out == 0 then
	return "no matches for " .. params.pattern
end

if truncated then
	table.insert(out, "[stopped at max_results=" .. limit .. "]")
end

return table.concat(out, "\n")
