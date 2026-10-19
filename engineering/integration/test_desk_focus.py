"""Contract tests use inert HTML only and never claim keyboard/browser execution."""
import unittest
from desk_focus import inspect_desk_focus


def fixture():
    html='<div tabindex="0" role="region"><table></table></div>'+''.join('<input id="cm-qty-'+name+'">' for name in ['stellar','laurentian','boreal'])+'<button id="cm-desk-evaluate">Evaluate</button><script>scrollRegion.tabIndex = scrollRegion.scrollWidth > scrollRegion.clientWidth ? 0 : -1;</script>'
    actions=[{'type':'move','x':500,'y':300}]
    for quantity in ['10','30','0']:actions += [{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['CTRL','A']},{'type':'type','text':quantity}]
    return {'task':{'html':html}},actions


class DeskFocusTests(unittest.TestCase):
    def test_runtime_non_overflow_focus_rule_requires_browser_acceptance(self):
        handoff,actions=fixture();result=inspect_desk_focus(handoff,actions);self.assertIsNone(result['actualBrowserActions']);self.assertTrue(result['browserAcceptanceStillRequired'])
    def test_extra_tab_that_broke_actual_native_run_is_refused(self):
        handoff,actions=fixture();actions.insert(1,{'type':'keypress','keys':['TAB']})
        with self.assertRaises(ValueError):inspect_desk_focus(handoff,actions)
    def test_new_focusable_before_inputs_requires_new_reviewed_actions(self):
        handoff,actions=fixture();handoff['task']['html']='<a href="#">New link</a>'+handoff['task']['html']
        with self.assertRaisesRegex(ValueError,'FOCUS_ORDER'):inspect_desk_focus(handoff,actions)
    def test_positive_tabindex_requires_new_review(self):
        handoff,actions=fixture();handoff['task']['html']='<button tabindex="1">New first target</button>'+handoff['task']['html']
        with self.assertRaisesRegex(ValueError,'POSITIVE_TAB_ORDER'):inspect_desk_focus(handoff,actions)
    def test_changed_runtime_overflow_rule_requires_new_review(self):
        handoff,actions=fixture();handoff['task']['html']=handoff['task']['html'].replace('? 0 : -1','? 0 : 0')
        with self.assertRaisesRegex(ValueError,'RUNTIME_FOCUS_RULE'):inspect_desk_focus(handoff,actions)


if __name__=='__main__':unittest.main()
