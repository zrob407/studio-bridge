local UserInputService = game:GetService("UserInputService")
local MAX_SECONDS = 50

if type(params.steps) ~= "table" or #params.steps == 0 then
	error("steps is required, for example [{\"key\": \"W\", \"hold\": 1}]")
end

local lookup = {}

for _, item in ipairs(Enum.KeyCode:GetEnumItems()) do
	lookup[string.lower(item.Name)] = item
end

local function keyOf(name)
	local found = lookup[string.lower(tostring(name or ""))]

	if not found then
		error("unknown key " .. tostring(name) .. "; use names like W, Space, LeftShift, Return, One or Escape")
	end

	return found
end

local total = 0

for _, step in ipairs(params.steps) do
	local seconds = if step.action == "wait" then step.seconds or 0 else (if step.action == nil or step.action == "press" then step.hold or 0.08 else 0)

	total += seconds + 0.05
end

if total > MAX_SECONDS then
	error(string.format("these steps take about %.0fs; one call can run at most %ds, so split them up", total, MAX_SECONDS))
end

local input = UserInputService:CreateVirtualInput()
local held = {}
local lines = {}

local ran, problem = pcall(function()
	for index, step in ipairs(params.steps) do
		local action = step.action or "press"

		if action == "press" then
			local key = keyOf(step.key)

			input:SendKey(true, key, false)
			task.wait(step.hold or 0.08)
			input:SendKey(false, key, false)
			table.insert(lines, "pressed " .. key.Name)
		elseif action == "down" then
			local key = keyOf(step.key)

			input:SendKey(true, key, false)
			held[key] = true
			table.insert(lines, "holding " .. key.Name)
		elseif action == "up" then
			local key = keyOf(step.key)

			input:SendKey(false, key, false)
			held[key] = nil
			table.insert(lines, "released " .. key.Name)
		elseif action == "text" then
			input:SendTextInput(tostring(step.text or ""))
			table.insert(lines, "typed " .. string.format("%q", tostring(step.text or "")))
		elseif action == "release_all" then
			for key in pairs(held) do
				input:SendKey(false, key, false)
			end

			held = {}
			table.insert(lines, "released every held key")
		elseif action == "wait" then
			task.wait(step.seconds or 0)
			table.insert(lines, "waited " .. (step.seconds or 0) .. "s")
		else
			error("step " .. index .. ": action must be press, down, up, text, release_all or wait")
		end

		task.wait(0.05)
	end
end)

if not ran then
	for key in pairs(held) do
		pcall(function()
			input:SendKey(false, key, false)
		end)
	end

	error(tostring(problem) .. " (held keys were released)")
end

local stillHeld = {}

for key in pairs(held) do
	table.insert(stillHeld, key.Name)
end

if #stillHeld > 0 then
	table.insert(lines, "still holding: " .. table.concat(stillHeld, ", ") .. " (release with action up or release_all)")
end

return table.concat(lines, "\n")
