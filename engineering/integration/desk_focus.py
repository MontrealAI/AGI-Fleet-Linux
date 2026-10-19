"""Static exact-desk keyboard contract. This is not browser execution evidence."""
from html.parser import HTMLParser
import re


class FocusableElements(HTMLParser):
    def __init__(self):super().__init__();self.elements=[]
    def handle_starttag(self,tag,attributes):
        attrs=dict(attributes)
        if 'hidden' in attrs or 'disabled' in attrs:return
        index=attrs.get('tabindex')
        if index is not None:
            if int(index)<0:return
            if int(index)>0:raise ValueError('POSITIVE_TAB_ORDER_REQUIRES_NEW_FIXTURE')
        if index is not None or tag in {'input','button','select','textarea','summary'} or tag=='a' and 'href' in attrs:
            self.elements.append({'tag':tag,'id':attrs.get('id'),'role':attrs.get('role'),'tabindex':index})


def inspect_desk_focus(handoff,actions):
    parser=FocusableElements();parser.feed(handoff['task']['html']);elements=parser.elements
    expected=[{'tag':'div','id':None,'role':'region','tabindex':'0'}]+[{'tag':'input','id':'cm-qty-'+name,'role':None,'tabindex':None} for name in ['stellar','laurentian','boreal']]
    if elements[:4]!=expected:raise ValueError('DESK_FOCUS_ORDER_CHANGED')
    if len(elements)<5 or elements[4]['id']!='cm-desk-evaluate' or elements[4]['tag']!='button':raise ValueError('DESK_EVALUATE_FOCUS_CHANGED')
    # Markup alone does not describe runtime focus: the reviewed desk removes the
    # table from keyboard order when it fits. Actual native browser acceptance is
    # required to validate layout at its fixed 1024x768 viewport.
    if not re.search(r'scrollRegion\.tabIndex\s*=\s*scrollRegion\.scrollWidth\s*>\s*scrollRegion\.clientWidth\s*\?\s*0\s*:\s*-1\s*;',handoff['task']['html']):raise ValueError('DESK_RUNTIME_FOCUS_RULE_CHANGED')
    if actions[:1]!=[{'type':'move','x':500,'y':300}]:raise ValueError('DESK_INITIAL_ACTION_CHANGED')
    for index in range(3):
        group=actions[1+index*3:4+index*3]
        if len(group)!=3 or group[0]!={'type':'keypress','keys':['TAB']} or group[1]!={'type':'keypress','keys':['CTRL','A']} or group[2].get('type')!='type':raise ValueError('DESK_INPUT_ACTIONS_CHANGED')
    return {'schema':'agi-fleet/static-desk-focus-observation/v1','evidenceClass':'STATIC_MARKUP_AND_RUNTIME_RULE_NO_BROWSER_EXECUTION','staticFocusCandidates':elements[:5],'runtimeScrollFocusRule':'TABLE_REMOVED_WHEN_NOT_OVERFLOWING','nativeViewport':{'width':1024,'height':768},'plannedActionCount':len(actions),'actualBrowserActions':None,'actualScreenshots':None,'browserAcceptanceStillRequired':True}
