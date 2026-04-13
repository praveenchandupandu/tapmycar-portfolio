f = open('public/activity.html', 'r', encoding='utf-8')
content = f.read()
f.close()
old = "contentHTML = scan.photo_url"
new = "contentHTML = ''; if(scan.message_text){contentHTML += '<div style=\"background:#FFF3EC;border-radius:12px;padding:14px;margin-bottom:12px\"><div style=\"font-size:11px;color:#FF6B00;font-weight:700\">Message</div><div style=\"font-size:14px;color:#111\">\"' + scan.message_text + '\"</div></div>';} contentHTML += scan.photo_url"
content = content.replace(old, new)
f = open('public/activity.html', 'w', encoding='utf-8')
f.write(content)
f.close()
print('done')
